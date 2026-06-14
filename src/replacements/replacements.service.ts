import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AddressType,
  BalancePaymentStatus,
  OrderStatus,
  ReplacementStatus,
  Role,
} from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RatingsService } from '../ratings/ratings.service';
import { DelhiveryService } from '../delhivery/delhivery.service';
import { CreateReplacementDto } from './dto/create-replacement.dto';
import { DecideReplacementDto } from './dto/decide-replacement.dto';
import {
  buildVybeKartMailShellHtml,
  escapeHtml,
  getVybeKartMailBranding,
} from '../mail/templates/vybekart-email-layout';
import {
  findVariantItem,
  parseVariantItems,
  productHasVariantItems,
} from '../products/product-variants.util';
import { resolvePublicBaseUrl } from '../common/utils/public-base-url';
import {
  isDelhiveryDeliveredStatus,
  resolveSellerDateRange,
} from '../orders/seller-order.mapper';
import { mapReplacementDetail } from './replacement.mapper';

const SUBMIT_DAYS = 3;
const AUTO_APPROVE_MIN_SCORE = 3;

const BLOCKING_STATUSES: ReplacementStatus[] = [
  ReplacementStatus.REQUESTED,
  ReplacementStatus.PENDING_ADMIN_REVIEW,
  ReplacementStatus.AWAITING_PAYMENT,
  ReplacementStatus.APPROVED,
  ReplacementStatus.PACKED,
  ReplacementStatus.SHIPPED,
];

@Injectable()
export class ReplacementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly ratings: RatingsService,
    private readonly config: ConfigService,
    private readonly delhivery: DelhiveryService,
  ) {}

  private assertSellerCanFulfill(req: {
    status: ReplacementStatus;
    balanceDue: number;
    balancePaymentStatus: BalancePaymentStatus;
  }) {
    if (req.status === ReplacementStatus.AWAITING_PAYMENT) {
      throw new BadRequestException('Waiting for buyer balance payment');
    }
    if (
      req.balanceDue > 0 &&
      req.balancePaymentStatus !== BalancePaymentStatus.PAID
    ) {
      throw new BadRequestException('Buyer has not paid the balance amount');
    }
  }

  private resolveApprovalStatus(balanceDue: number): {
    status: ReplacementStatus;
    balancePaymentStatus: BalancePaymentStatus;
  } {
    if (balanceDue > 0) {
      return {
        status: ReplacementStatus.AWAITING_PAYMENT,
        balancePaymentStatus: BalancePaymentStatus.PENDING,
      };
    }
    return {
      status: ReplacementStatus.APPROVED,
      balancePaymentStatus: BalancePaymentStatus.NONE,
    };
  }

  private computePricing(
    line: { price: number; variantId: string | null },
    product: { variants: unknown; price: number },
    replacementVariantId?: string | null,
  ) {
    const originalUnitPrice = line.price;
    let replacementUnitPrice = product.price;
    let replacementVariantLabel: string | null = null;

    if (productHasVariantItems(product.variants)) {
      if (!replacementVariantId) {
        throw new BadRequestException('Please select a replacement variant');
      }
      const variant = findVariantItem(product.variants, replacementVariantId);
      if (!variant) {
        throw new BadRequestException('Invalid replacement variant');
      }
      replacementUnitPrice = variant.sellingPrice;
      replacementVariantLabel = variant.label;
    } else if (replacementVariantId) {
      throw new BadRequestException('This product has no variants');
    }

    const balanceDue = Math.max(0, replacementUnitPrice - originalUnitPrice);
    return {
      originalUnitPrice,
      replacementUnitPrice,
      replacementVariantLabel,
      balanceDue,
    };
  }

  async getVariantOptionsForOrder(
    userId: string,
    orderId: string,
    orderItemId: string,
  ) {
    const buyer = await this.prisma.buyer.findUnique({ where: { userId } });
    if (!buyer) throw new NotFoundException('Buyer not found');

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, buyerId: buyer.id },
      include: {
        items: { include: { product: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    const line = order.items.find((i) => i.id === orderItemId);
    if (!line?.product) throw new BadRequestException('Order line not found');

    const variants = parseVariantItems(line.product.variants);
    const currentVariantId = line.variantId;

    return {
      orderItemId: line.id,
      productId: line.product.id,
      productName: line.product.name,
      currentVariantId,
      currentVariantLabel: line.variantLabel,
      currentUnitPrice: line.price,
      options: variants.map((v) => ({
        id: v.id,
        label: v.label,
        sellingPrice: v.sellingPrice,
        stock: v.stock,
        isCurrent: v.id === currentVariantId,
        balanceDue: Math.max(0, v.sellingPrice - line.price),
      })),
    };
  }

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

    const existing = await this.prisma.replacementRequest.findFirst({
      where: {
        orderId,
        status: { not: ReplacementStatus.REJECTED },
      },
    });
    if (existing) {
      throw new BadRequestException(
        existing.status === ReplacementStatus.DELIVERED
          ? 'A replacement has already been completed for this order'
          : 'A replacement request already exists for this order',
      );
    }

    const line = order.items.find((i) => i.id === dto.orderItemId);
    if (!line?.product) {
      throw new BadRequestException('Order line not found');
    }
    if (line.product.returnable === false) {
      throw new BadRequestException('This product is not replaceable');
    }

    const pricing = this.computePricing(
      line,
      line.product,
      dto.replacementVariantId,
    );

    const sellerId = line.product.sellerId;
    const buyerScore = await this.ratings.getBuyerScore(buyer.id);
    const autoApprove = buyerScore >= AUTO_APPROVE_MIN_SCORE;

    let status: ReplacementStatus = ReplacementStatus.PENDING_ADMIN_REVIEW;
    let balancePaymentStatus: BalancePaymentStatus = BalancePaymentStatus.NONE;
    let decidedAt: Date | null = null;

    if (autoApprove) {
      const approval = this.resolveApprovalStatus(pricing.balanceDue);
      status = approval.status;
      balancePaymentStatus = approval.balancePaymentStatus;
      decidedAt = new Date();
    }

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
        decidedAt,
        replacementVariantId: dto.replacementVariantId ?? line.variantId,
        replacementVariantLabel:
          pricing.replacementVariantLabel ?? line.variantLabel,
        originalUnitPrice: pricing.originalUnitPrice,
        replacementUnitPrice: pricing.replacementUnitPrice,
        balanceDue: pricing.balanceDue,
        balancePaymentStatus,
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

    return mapReplacementDetail(
      {
        ...req,
        order: {
          id: order.id,
          totalAmount: order.totalAmount,
          items: order.items.map((i) => ({
            id: i.id,
            quantity: i.quantity,
            price: i.price,
            variantId: i.variantId,
            variantLabel: i.variantLabel,
            product: {
              id: i.product.id,
              name: i.product.name,
              images: i.product.images ?? [],
            },
          })),
        },
      },
      'buyer',
    );
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
      take: 50,
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                images: true,
                returnable: true,
              },
            },
          },
        },
        replacementRequests: true,
      },
    });

    const out: Array<{
      orderId: string;
      orderItemId: string;
      deliveredAt: Date | null;
      totalAmount: number;
      productName: string;
      productImage: string | null;
      variantLabel: string | null;
      unitPrice: number;
      daysLeft: number;
    }> = [];

    for (const o of orders) {
      if (!o.deliveredAt) continue;
      const deadline = new Date(o.deliveredAt);
      deadline.setDate(deadline.getDate() + SUBMIT_DAYS);
      if (new Date() > deadline) continue;

      const blocking = o.replacementRequests.some(
        (r) => r.status !== ReplacementStatus.REJECTED,
      );
      if (blocking) continue;

      const daysLeft = Math.max(
        0,
        Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
      );

      for (const item of o.items) {
        if (item.product?.returnable === false) continue;
        out.push({
          orderId: o.id,
          orderItemId: item.id,
          deliveredAt: o.deliveredAt,
          totalAmount: o.totalAmount,
          productName: item.product?.name ?? 'Product',
          productImage: item.product?.images?.[0] ?? null,
          variantLabel: item.variantLabel,
          unitPrice: item.price,
          daysLeft,
        });
      }
    }

    return out;
  }

  async listForBuyer(userId: string) {
    const buyer = await this.prisma.buyer.findUnique({ where: { userId } });
    if (!buyer) throw new NotFoundException('Buyer not found');
    const rows = await this.prisma.replacementRequest.findMany({
      where: { buyerId: buyer.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        order: {
          include: {
            items: { include: { product: { select: { id: true, name: true, images: true } } } },
          },
        },
        seller: { select: { businessName: true, logoUrl: true } },
      },
    });
    return rows.map((r) => mapReplacementDetail(r, 'buyer'));
  }

  async getBuyerDetail(userId: string, id: string) {
    const buyer = await this.prisma.buyer.findUnique({ where: { userId } });
    if (!buyer) throw new NotFoundException('Buyer not found');
    const req = await this.prisma.replacementRequest.findFirst({
      where: { id, buyerId: buyer.id },
      include: {
        order: {
          include: {
            items: { include: { product: true } },
          },
        },
        seller: { select: { businessName: true, logoUrl: true } },
      },
    });
    if (!req) throw new NotFoundException('Replacement not found');
    return mapReplacementDetail(req, 'buyer');
  }

  async markBalancePaid(replacementId: string, razorpayPaymentId: string) {
    const req = await this.prisma.replacementRequest.findUnique({
      where: { id: replacementId },
      include: { buyer: { include: { user: true } } },
    });
    if (!req) throw new NotFoundException('Replacement not found');
    if (req.status !== ReplacementStatus.AWAITING_PAYMENT) {
      return req;
    }
    return this.prisma.replacementRequest.update({
      where: { id: replacementId },
      data: {
        status: ReplacementStatus.APPROVED,
        balancePaymentStatus: BalancePaymentStatus.PAID,
        razorpayPaymentId,
      },
      include: {
        buyer: { include: { user: true } },
        order: true,
        seller: true,
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

    const rows = await this.prisma.replacementRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          include: {
            items: { include: { product: true } },
          },
        },
        seller: { select: { businessName: true, logoUrl: true } },
      },
    });
    return rows.map((r) =>
      mapReplacementDetail(r, buyer ? 'buyer' : seller ? 'seller' : 'admin'),
    );
  }

  async listForSeller(
    userId: string,
    page = 1,
    limit = 20,
    status?: ReplacementStatus,
    date?: string,
  ) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('Seller not found');
    const skip = (page - 1) * limit;
    const dateRange = resolveSellerDateRange(date);
    const where = {
      sellerId: seller.id,
      ...(status ? { status } : {}),
      ...(dateRange ? { createdAt: dateRange } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.replacementRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            include: {
              items: { include: { product: { select: { id: true, name: true, images: true } } } },
            },
          },
          buyer: { include: { user: { select: { name: true, email: true } } } },
        },
      }),
      this.prisma.replacementRequest.count({ where }),
    ]);
    return {
      items: items.map((r) => mapReplacementDetail(r, 'seller')),
      total,
      page,
      limit,
    };
  }

  async getSellerDetail(userId: string, id: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('Seller not found');
    const req = await this.prisma.replacementRequest.findFirst({
      where: { id, sellerId: seller.id },
      include: {
        order: {
          include: {
            items: { include: { product: true } },
            buyer: { include: { user: true } },
          },
        },
        buyer: { include: { user: { select: { name: true, email: true, phone: true } } } },
      },
    });
    if (!req) throw new NotFoundException('Replacement not found');
    return mapReplacementDetail(req, 'seller');
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
          order: { include: { items: { include: { product: true } } } },
          buyer: { include: { user: true, rating: true } },
          seller: { include: { user: true, rating: true } },
        },
      }),
      this.prisma.replacementRequest.count({ where }),
    ]);
    return {
      items: items.map((r) => mapReplacementDetail(r, 'admin')),
      total,
      page,
      limit,
    };
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
    return { ...mapReplacementDetail(req, 'admin'), sellerPublic };
  }

  async decide(id: string, adminUserId: string, dto: DecideReplacementDto) {
    const req = await this.prisma.replacementRequest.findUnique({
      where: { id },
      include: {
        buyer: { include: { user: true } },
        seller: true,
        order: {
          include: {
            items: { include: { product: true } },
          },
        },
      },
    });
    if (!req) throw new NotFoundException('Replacement not found');
    if (req.status !== ReplacementStatus.PENDING_ADMIN_REVIEW) {
      throw new BadRequestException('Request is not pending admin review');
    }

    if (!dto.approved) {
      const updated = await this.prisma.replacementRequest.update({
        where: { id },
        data: {
          status: ReplacementStatus.REJECTED,
          adminNote: dto.adminNote ?? null,
          decidedAt: new Date(),
          decidedByAdminId: adminUserId,
        },
        include: {
          buyer: { include: { user: true } },
          order: { include: { items: { include: { product: true } } } },
          seller: { select: { businessName: true, logoUrl: true } },
        },
      });
      if (updated.buyer.user.email) {
        await this.mail.sendToBuyer(updated.buyer.user.email, {
          subject: 'Vybekart — replacement request update',
          text: `Your replacement request could not be approved at this time.${dto.adminNote ? `\n\nNote: ${dto.adminNote}` : ''}\n\n— Vybekart`,
        });
      }
      return mapReplacementDetail(updated, 'admin');
    }

    const approval = this.resolveApprovalStatus(req.balanceDue);
    const updated = await this.prisma.replacementRequest.update({
      where: { id },
      data: {
        status: approval.status,
        balancePaymentStatus: approval.balancePaymentStatus,
        adminNote: dto.adminNote ?? null,
        decidedAt: new Date(),
        decidedByAdminId: adminUserId,
      },
      include: {
        buyer: { include: { user: true } },
        order: { include: { items: { include: { product: true } } } },
        seller: { select: { businessName: true, logoUrl: true } },
      },
    });

    await this.sendBuyerApprovedEmail(updated);
    return mapReplacementDetail(updated, 'admin');
  }

  async uploadPackingVideo(
    id: string,
    userId: string,
    file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Video file is required');
    }
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new ForbiddenException('User is not a registered seller');

    const req = await this.prisma.replacementRequest.findFirst({
      where: { id, sellerId: seller.id },
      include: {
        order: { include: { items: { include: { product: true } } } },
      },
    });
    if (!req) throw new NotFoundException('Replacement not found');
    if (req.status !== ReplacementStatus.APPROVED) {
      throw new BadRequestException('Replacement must be approved before packing');
    }
    this.assertSellerCanFulfill(req);

    const dir = path.join(process.cwd(), 'uploads', 'packing', 'replacements');
    await fs.mkdir(dir, { recursive: true });
    const ext = path.extname(file.originalname) || '.mp4';
    const fname = `repl_${id}${ext}`;
    await fs.writeFile(path.join(dir, fname), file.buffer);
    const base = resolvePublicBaseUrl(this.config);
    const packingVideoUrl = `${base}/uploads/packing/replacements/${fname}`;

    const updated = await this.prisma.replacementRequest.update({
      where: { id },
      data: {
        packingVideoUrl,
        packedAt: new Date(),
        status: ReplacementStatus.PACKED,
      },
      include: {
        order: { include: { items: { include: { product: true } } } },
        buyer: { include: { user: true } },
      },
    });
    return mapReplacementDetail(updated, 'seller');
  }

  async requestDeliveryFromPartner(id: string, userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new ForbiddenException('User is not a registered seller');

    const req = await this.prisma.replacementRequest.findFirst({
      where: { id, sellerId: seller.id },
      include: {
        order: {
          include: {
            items: { include: { product: true } },
            buyer: { include: { user: true } },
          },
        },
      },
    });
    if (!req) throw new NotFoundException('Replacement not found');
    if (req.status !== ReplacementStatus.PACKED) {
      throw new BadRequestException('Replacement must be packed first');
    }
    this.assertSellerCanFulfill(req);

    const order = req.order;
    const pickup = await this.prisma.address.findFirst({
      where: { userId, type: AddressType.PICKUP },
      orderBy: { createdAt: 'desc' },
    });
    if (!pickup) {
      throw new BadRequestException(
        'Pickup address is missing. Please update pickup address in store profile.',
      );
    }
    const buyerPhone = order.buyer?.user?.phone;
    if (!buyerPhone) throw new BadRequestException('Buyer phone is missing');
    const dropAddress = order.shippingAddress?.trim();
    if (!dropAddress) {
      throw new BadRequestException('Order shipping address is missing');
    }

    const destPinMatch = dropAddress.match(/\b(\d{6})\b/);
    const destPin = destPinMatch?.[1] ?? '';
    const originPin = pickup.zip?.trim() ?? '';

    if (!originPin || originPin.length !== 6) {
      throw new BadRequestException(
        'Pickup pincode is missing or invalid. Update pickup address in store profile.',
      );
    }
    if (!destPin || destPin.length !== 6) {
      throw new BadRequestException(
        'Could not find a valid 6-digit pincode in the shipping address.',
      );
    }
    if (!this.delhivery.isConfigured()) {
      throw new ServiceUnavailableException(
        'Delhivery is not configured on the server. Contact support.',
      );
    }

    const pickupLocationName =
      this.config.get<string>('DELHIVERY_PICKUP_LOCATION')?.trim() ||
      seller.businessName?.trim() ||
      '';

    const shipmentData = await this.delhivery.createShipment({
      orderId: id.replace(/-/g, '').slice(0, 32),
      pickupLocationName,
      originPin,
      destinationPin: destPin,
      consigneeName: order.buyer?.user?.name ?? 'Buyer',
      consigneePhone: normalizeInPhone(buyerPhone),
      consigneeAddress: dropAddress,
      weightGrams: 500,
      paymentMode: 'Pre-paid',
      shippingMode: 'Express',
    });

    if (!shipmentData?.waybill) {
      const detail =
        typeof shipmentData?.raw === 'object' && shipmentData?.raw !== null
          ? JSON.stringify(shipmentData.raw).slice(0, 300)
          : 'no waybill returned';
      throw new BadRequestException(
        `Delhivery could not create shipment. ${detail}`,
      );
    }

    const updated = await this.prisma.replacementRequest.update({
      where: { id },
      data: {
        status: ReplacementStatus.SHIPPED,
        shippedAt: new Date(),
        carrierName: 'Delhivery',
        trackingId: shipmentData.waybill,
        deliveryProvider: 'DELHIVERY',
        borzoTrackingUrl: shipmentData.trackingUrl,
        deliveryStatus: shipmentData.status ?? 'Created',
      },
      include: {
        order: { include: { items: { include: { product: true } } } },
        buyer: { include: { user: true } },
      },
    });
    return mapReplacementDetail(updated, 'seller');
  }

  async getDeliveryStatus(id: string, userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new ForbiddenException('User is not a registered seller');

    const req = await this.prisma.replacementRequest.findFirst({
      where: { id, sellerId: seller.id },
      include: {
        order: { include: { items: { include: { product: true } } } },
      },
    });
    if (!req) throw new NotFoundException('Replacement not found');

    if (req.deliveryProvider === 'DELHIVERY' && req.trackingId) {
      const track = await this.delhivery.trackShipment(req.trackingId);
      const status = track?.status ?? req.deliveryStatus ?? null;
      const markDelivered = isDelhiveryDeliveredStatus(status);
      const updated = await this.prisma.replacementRequest.update({
        where: { id },
        data: {
          deliveryStatus: status ?? req.deliveryStatus,
          ...(markDelivered
            ? {
                status: ReplacementStatus.DELIVERED,
                deliveredAt: req.deliveredAt ?? new Date(),
              }
            : {}),
        },
        include: {
          order: { include: { items: { include: { product: true } } } },
        },
      });
      return {
        deliveryStatus: updated.deliveryStatus,
        trackingId: updated.trackingId,
        replacementStatus: updated.status,
        replacement: mapReplacementDetail(updated, 'seller'),
      };
    }

    return {
      deliveryStatus: req.deliveryStatus,
      trackingId: req.trackingId,
      replacementStatus: req.status,
      replacement: mapReplacementDetail(req, 'seller'),
    };
  }

  /** @deprecated Use requestDeliveryFromPartner */
  async ship(id: string, userId: string) {
    return this.requestDeliveryFromPartner(id, userId);
  }

  /** @deprecated Manual deliver — prefer tracking poll */
  async deliver(id: string, userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('Seller not found');
    const req = await this.prisma.replacementRequest.findFirst({
      where: { id, sellerId: seller.id, status: ReplacementStatus.SHIPPED },
      include: {
        order: { include: { items: { include: { product: true } } } },
      },
    });
    if (!req) throw new NotFoundException('Replacement not found');
    const updated = await this.prisma.replacementRequest.update({
      where: { id },
      data: {
        status: ReplacementStatus.DELIVERED,
        deliveredAt: new Date(),
      },
      include: {
        order: { include: { items: { include: { product: true } } } },
      },
    });
    return mapReplacementDetail(updated, 'seller');
  }

  private async sendSupportEmail(req: {
    id: string;
    orderId: string;
    reason: string;
    status: ReplacementStatus;
    sellerId: string;
    buyer: { user: { name: string; email: string }; rating: { score: number; replacementCount: number } | null };
    seller: { businessName: string };
  }) {
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

  private async sendBuyerReceivedEmail(req: {
    buyer: { user: { email: string; name: string } };
    id: string;
  }) {
    if (!req.buyer.user.email) return;
    const branding = getVybeKartMailBranding(this.config);
    const name = escapeHtml(req.buyer.user.name);
    const html = buildVybeKartMailShellHtml({
      branding,
      recipientEmail: req.buyer.user.email,
      headerBadge: 'Replacement',
      headerTitle: 'We received your request',
      headerSubtitle: 'Our team is reviewing it now',
      bodyHtml: `<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.55;">Hi ${name},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.55;">We received your <strong>replacement request</strong> and it is under review. You will receive another email once it is confirmed.</p>
        <p style="margin:0;font-size:13px;color:#64748b;">Reference: ${escapeHtml(req.id)}</p>`,
      whyReceivedHtml:
        'You submitted a replacement request on Vybekart for a recent order.',
    });
    await this.mail.sendToBuyer(req.buyer.user.email, {
      subject: 'Vybekart — replacement request received',
      html,
      text: `Hi ${req.buyer.user.name},\n\nYour replacement request is under process. We will confirm shortly.\n\n— Vybekart`,
    });
  }

  async sendBuyerApprovedEmail(req: {
    id: string;
    balanceDue: number;
    buyer: { user: { email: string; name: string } };
  }) {
    if (!req.buyer.user.email) return;
    const branding = getVybeKartMailBranding(this.config);
    const name = escapeHtml(req.buyer.user.name);
    const payBlock =
      req.balanceDue > 0
        ? `<p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.55;">An additional <strong>₹${req.balanceDue.toFixed(0)}</strong> is due for the upgraded variant. Open the Vybekart app → <strong>Replacements</strong> to pay and complete your request.</p>
           <p style="margin:0;font-size:13px;color:#64748b;">Reference: ${escapeHtml(req.id)}</p>`
        : `<p style="margin:0;font-size:15px;color:#334155;line-height:1.55;">Your replacement request has been <strong>approved</strong>. The seller will pack and ship your replacement soon.</p>`;

    const html = buildVybeKartMailShellHtml({
      branding,
      recipientEmail: req.buyer.user.email,
      headerBadge: 'Replacement',
      headerTitle: req.balanceDue > 0 ? 'Replacement approved — payment due' : 'Replacement approved!',
      headerSubtitle:
        req.balanceDue > 0 ? 'Pay the balance to proceed' : 'Your seller will ship soon',
      bodyHtml: `<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.55;">Hi ${name},</p>${payBlock}`,
      whyReceivedHtml:
        'Your Vybekart replacement request was approved by our team or seller.',
    });
    await this.mail.sendToBuyer(req.buyer.user.email, {
      subject:
        req.balanceDue > 0
          ? 'Vybekart — replacement approved, balance payment required'
          : 'Vybekart — replacement initiated',
      html,
      text:
        req.balanceDue > 0
          ? `Hi ${req.buyer.user.name},\n\nYour replacement was approved. Please pay ₹${req.balanceDue.toFixed(0)} in the app under Replacements.\n\n— Vybekart`
          : `Hi ${req.buyer.user.name},\n\nYour replacement has been approved and initiated.\n\n— Vybekart`,
    });
  }
}

function normalizeInPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return digits;
}
