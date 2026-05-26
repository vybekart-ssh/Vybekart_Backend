import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  ReplacementStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RatingsService } from '../ratings/ratings.service';
import { CreateReplacementDto } from './dto/create-replacement.dto';
import { DecideReplacementDto } from './dto/decide-replacement.dto';

const SUBMIT_DAYS = 3;
const AUTO_APPROVE_MIN_SCORE = 3;

@Injectable()
export class ReplacementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly ratings: RatingsService,
  ) {}

  async createForOrder(userId: string, orderId: string, dto: CreateReplacementDto) {
    const buyer = await this.prisma.buyer.findUnique({ where: { userId } });
    if (!buyer) throw new NotFoundException('Buyer not found');

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, buyerId: buyer.id },
      include: {
        items: { include: { product: true } },
        buyer: { include: { user: true, rating: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException('Only delivered orders can be replaced');
    }
    if (!order.deliveredAt) {
      throw new BadRequestException('Order delivery date missing');
    }
    const deadline = new Date(order.deliveredAt);
    deadline.setDate(deadline.getDate() + SUBMIT_DAYS);
    if (new Date() > deadline) {
      throw new BadRequestException(
        'Replacement requests must be submitted within 3 days of delivery',
      );
    }

    const open = await this.prisma.replacementRequest.findFirst({
      where: {
        orderId,
        status: {
          notIn: [ReplacementStatus.REJECTED, ReplacementStatus.DELIVERED],
        },
      },
    });
    if (open) {
      throw new BadRequestException('A replacement request is already open');
    }

    const line = dto.orderItemId
      ? order.items.find((i) => i.id === dto.orderItemId)
      : order.items[0];
    if (!line?.product) {
      throw new BadRequestException('Order line not found');
    }
    if (line.product.returnable === false) {
      throw new BadRequestException('This product is not replaceable');
    }

    const sellerId = line.product.sellerId;
    const buyerScore = await this.ratings.getBuyerScore(buyer.id);
    const autoApprove = buyerScore >= AUTO_APPROVE_MIN_SCORE;
    const status = autoApprove
      ? ReplacementStatus.APPROVED
      : ReplacementStatus.PENDING_ADMIN_REVIEW;

    const req = await this.prisma.replacementRequest.create({
      data: {
        orderId,
        buyerId: buyer.id,
        sellerId,
        orderItemId: line.id,
        reason: dto.reason,
        description: dto.description ?? null,
        photoUrls: dto.photoUrls ?? [],
        status,
        autoApproved: autoApprove,
        decidedAt: autoApprove ? new Date() : null,
      },
      include: {
        order: true,
        buyer: { include: { user: true, rating: true } },
        seller: { include: { user: true, rating: true } },
      },
    });

    await this.ratings.onReplacementRequested(buyer.id, sellerId);
    await this.sendSupportEmail(req);
    await this.sendBuyerReceivedEmail(req);

    if (autoApprove) {
      await this.sendBuyerApprovedEmail(req);
    }

    return req;
  }

  async listEligibleForBuyer(userId: string) {
    const buyer = await this.prisma.buyer.findUnique({ where: { userId } });
    if (!buyer) throw new NotFoundException('Buyer not found');

    const minDelivered = new Date();
    minDelivered.setDate(minDelivered.getDate() - SUBMIT_DAYS);

    const orders = await this.prisma.order.findMany({
      where: {
        buyerId: buyer.id,
        status: OrderStatus.DELIVERED,
        deliveredAt: { gte: minDelivered },
      },
      orderBy: { deliveredAt: 'desc' },
      take: 30,
      include: {
        items: { include: { product: { select: { id: true, name: true, images: true, returnable: true } } } },
        replacementRequests: {
          where: {
            status: {
              notIn: [ReplacementStatus.REJECTED, ReplacementStatus.DELIVERED],
            },
          },
        },
      },
    });

    return orders
      .filter((o) => {
        if (!o.deliveredAt) return false;
        const deadline = new Date(o.deliveredAt);
        deadline.setDate(deadline.getDate() + SUBMIT_DAYS);
        if (new Date() > deadline) return false;
        if (o.replacementRequests.length > 0) return false;
        const product = o.items[0]?.product;
        return product?.returnable !== false;
      })
      .map((o) => ({
        orderId: o.id,
        deliveredAt: o.deliveredAt,
        totalAmount: o.totalAmount,
        productName: o.items[0]?.product?.name ?? 'Product',
        productImage: o.items[0]?.product?.images?.[0] ?? null,
        orderItemId: o.items[0]?.id ?? null,
      }));
  }

  async listForBuyer(userId: string) {
    const buyer = await this.prisma.buyer.findUnique({ where: { userId } });
    if (!buyer) throw new NotFoundException('Buyer not found');
    return this.prisma.replacementRequest.findMany({
      where: { buyerId: buyer.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        order: { select: { id: true, totalAmount: true } },
        seller: { select: { businessName: true, logoUrl: true } },
      },
    });
  }

  async getForOrder(userId: string, orderId: string, roles: Role[]) {
    const buyer = await this.prisma.buyer.findUnique({ where: { userId } });
    const seller = await this.prisma.seller.findUnique({ where: { userId } });

    const where: { orderId: string; buyerId?: string; sellerId?: string } = {
      orderId,
    };
    if (roles.includes(Role.ADMIN)) {
      // no extra filter
    } else if (buyer) {
      where.buyerId = buyer.id;
    } else if (seller) {
      where.sellerId = seller.id;
    } else {
      throw new NotFoundException('Order not found');
    }

    return this.prisma.replacementRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async listForSeller(userId: string, page = 1, limit = 20) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('Seller not found');
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.replacementRequest.findMany({
        where: { sellerId: seller.id },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { id: true, totalAmount: true, status: true } },
          buyer: { include: { user: { select: { name: true, email: true } } } },
        },
      }),
      this.prisma.replacementRequest.count({ where: { sellerId: seller.id } }),
    ]);
    return { items, total, page, limit };
  }

  async listAdmin(status?: ReplacementStatus, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
      this.prisma.replacementRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: true,
          buyer: { include: { user: true, rating: true } },
          seller: { include: { user: true, rating: true } },
        },
      }),
      this.prisma.replacementRequest.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getAdminDetail(id: string) {
    const req = await this.prisma.replacementRequest.findUnique({
      where: { id },
      include: {
        order: { include: { items: { include: { product: true } } } },
        buyer: { include: { user: true, rating: true } },
        seller: { include: { user: true, rating: true } },
      },
    });
    if (!req) throw new NotFoundException('Replacement not found');
    const sellerPublic = await this.ratings.getSellerPublic(req.sellerId);
    return { ...req, sellerPublic };
  }

  async decide(id: string, adminUserId: string, dto: DecideReplacementDto) {
    const req = await this.prisma.replacementRequest.findUnique({
      where: { id },
      include: {
        buyer: { include: { user: true } },
        seller: true,
      },
    });
    if (!req) throw new NotFoundException('Replacement not found');
    if (req.status !== ReplacementStatus.PENDING_ADMIN_REVIEW) {
      throw new BadRequestException('Request is not pending admin review');
    }

    const status = dto.approved
      ? ReplacementStatus.APPROVED
      : ReplacementStatus.REJECTED;

    const updated = await this.prisma.replacementRequest.update({
      where: { id },
      data: {
        status,
        adminNote: dto.adminNote ?? null,
        decidedAt: new Date(),
        decidedByAdminId: adminUserId,
      },
      include: {
        buyer: { include: { user: true } },
        order: true,
      },
    });

    if (dto.approved) {
      await this.sendBuyerApprovedEmail(updated);
    } else if (updated.buyer.user.email) {
      await this.mail.sendToBuyer(updated.buyer.user.email, {
        subject: 'VybeKart — replacement request update',
        text: `Your replacement request could not be approved at this time.${dto.adminNote ? `\n\nNote: ${dto.adminNote}` : ''}\n\n— VybeKart`,
      });
    }

    return updated;
  }

  async ship(id: string, userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('Seller not found');
    const req = await this.prisma.replacementRequest.findFirst({
      where: { id, sellerId: seller.id, status: ReplacementStatus.APPROVED },
    });
    if (!req) throw new NotFoundException('Replacement not found');
    return this.prisma.replacementRequest.update({
      where: { id },
      data: { status: ReplacementStatus.SHIPPED },
    });
  }

  async deliver(id: string, userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('Seller not found');
    const req = await this.prisma.replacementRequest.findFirst({
      where: { id, sellerId: seller.id, status: ReplacementStatus.SHIPPED },
    });
    if (!req) throw new NotFoundException('Replacement not found');
    return this.prisma.replacementRequest.update({
      where: { id },
      data: { status: ReplacementStatus.DELIVERED },
    });
  }

  private async sendSupportEmail(
    req: Awaited<ReturnType<typeof this.createForOrder>>,
  ) {
    const sellerRating = await this.ratings.getSellerPublic(req.sellerId);
    const html = `
      <h2>Replacement request</h2>
      <p><b>Request ID:</b> ${req.id}</p>
      <p><b>Order:</b> ${req.orderId}</p>
      <p><b>Reason:</b> ${req.reason}</p>
      <p><b>Buyer:</b> ${req.buyer.user.name} (${req.buyer.user.email})</p>
      <p><b>Customer rating:</b> ${req.buyer.rating?.score ?? 'N/A'} (replacements: ${req.buyer.rating?.replacementCount ?? 0})</p>
      <p><b>Seller:</b> ${req.seller.businessName}</p>
      <p><b>Seller rating:</b> ${sellerRating.overall} (replacement %: ${sellerRating.replacementPercent})</p>
      <p><b>Status:</b> ${req.status}</p>
    `;
    await this.mail.sendToSupport({
      subject: `[Replacement] Order ${req.orderId}`,
      html,
      text: `Replacement ${req.id} for order ${req.orderId}. Status: ${req.status}`,
    });
  }

  private async sendBuyerReceivedEmail(
    req: { buyer: { user: { email: string; name: string } }; id: string },
  ) {
    if (!req.buyer.user.email) return;
    await this.mail.sendToBuyer(req.buyer.user.email, {
      subject: 'VybeKart — replacement request received',
      html: `<p>Hi ${req.buyer.user.name},</p><p>We received your replacement request and it is under review. You will receive another email once it is confirmed.</p><p>— VybeKart</p>`,
      text: `Hi ${req.buyer.user.name},\n\nYour replacement request is under process. We will confirm shortly.\n\n— VybeKart`,
    });
  }

  private async sendBuyerApprovedEmail(
    req: { buyer: { user: { email: string; name: string } }; id: string },
  ) {
    if (!req.buyer.user.email) return;
    await this.mail.sendToBuyer(req.buyer.user.email, {
      subject: 'VybeKart — replacement initiated',
      html: `<p>Hi ${req.buyer.user.name},</p><p>Your replacement request has been approved and is being processed. The seller will ship your replacement item soon.</p><p>— VybeKart</p>`,
      text: `Hi ${req.buyer.user.name},\n\nYour replacement has been approved and initiated.\n\n— VybeKart`,
    });
  }
}
