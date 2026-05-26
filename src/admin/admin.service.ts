import { Injectable, NotFoundException } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SellersService } from '../sellers/sellers.service';
import { AppConfigService } from '../app-config/app-config.service';
import { UpdateAppConfigDto } from './dto/update-app-config.dto';
import { RequestSellerChangesDto } from './dto/request-seller-changes.dto';
import { RatingsService } from '../ratings/ratings.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private sellersService: SellersService,
    private appConfig: AppConfigService,
    private ratings: RatingsService,
  ) {}

  listSellers(status?: VerificationStatus) {
    return this.sellersService.findAllForAdmin(status);
  }

  getSellerDetail(sellerId: string) {
    return this.sellersService.findOneSellerForAdmin(sellerId);
  }

  approveSeller(sellerId: string) {
    return this.sellersService.approve(sellerId);
  }

  rejectSeller(sellerId: string, reason?: string) {
    return this.sellersService.reject(sellerId, reason ?? '');
  }

  requestSellerChanges(input: {
    sellerId: string;
    adminUserId: string;
    dto: RequestSellerChangesDto;
  }) {
    return this.sellersService.requestChanges({
      sellerId: input.sellerId,
      adminUserId: input.adminUserId,
      sections: input.dto.sections,
      note: input.dto.note,
    });
  }

  reregisterSeller(sellerId: string) {
    return this.sellersService.reregisterSeller(sellerId);
  }

  getAppConfig() {
    return this.appConfig.getPublicAndroid();
  }

  async patchAppConfig(dto: UpdateAppConfigDto) {
    if (
      dto.minAndroidVersionCode === undefined &&
      dto.latestAndroidVersionName === undefined
    ) {
      return this.appConfig.getPublicAndroid();
    }
    await this.appConfig.updateAndroidConfig({
      minAndroidVersionCode: dto.minAndroidVersionCode,
      latestAndroidVersionName: dto.latestAndroidVersionName,
    });
    return this.appConfig.getPublicAndroid();
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, roles: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async listBuyers(q?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: Prisma.BuyerWhereInput = q?.trim()
      ? {
          user: {
            OR: [
              { name: { contains: q.trim(), mode: 'insensitive' } },
              { email: { contains: q.trim(), mode: 'insensitive' } },
              { phone: { contains: q.trim(), mode: 'insensitive' } },
            ],
          },
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.buyer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              createdAt: true,
            },
          },
          rating: true,
          _count: { select: { replacementRequests: true } },
        },
      }),
      this.prisma.buyer.count({ where }),
    ]);

    return {
      items: items.map((b) => ({
        buyerId: b.id,
        userId: b.userId,
        name: b.user.name,
        email: b.user.email,
        phone: b.user.phone,
        createdAt: b.user.createdAt,
        score: b.rating?.score ?? 5,
        replacementCount: b._count.replacementRequests,
      })),
      total,
      page,
      limit,
    };
  }

  async getBuyerDetail(buyerId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { id: buyerId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            createdAt: true,
            isActive: true,
          },
        },
        rating: true,
        replacementRequests: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { order: { select: { id: true, status: true, totalAmount: true } } },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 30,
          include: {
            items: {
              include: {
                product: {
                  include: { seller: { select: { businessName: true } } },
                },
              },
            },
          },
        },
        follows: {
          include: {
            seller: {
              select: {
                id: true,
                businessName: true,
                logoUrl: true,
              },
            },
          },
        },
      },
    });
    if (!buyer) throw new NotFoundException('Buyer not found');

    const user = buyer.user;
    const addresses = await this.prisma.address.findMany({
      where: { userId: user.id, type: 'SHIPPING' },
    });
    const supportTickets = await this.prisma.supportTicket.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const lastOrder = buyer.orders[0];
    const lastReplacement = buyer.replacementRequests[0];

    return {
      buyer: {
        id: buyer.id,
        user,
        rating: buyer.rating,
      },
      replacements: buyer.replacementRequests,
      orders: buyer.orders.map((o) => ({
        id: o.id,
        status: o.status,
        totalAmount: o.totalAmount,
        createdAt: o.createdAt,
        sellerName: o.items[0]?.product?.seller?.businessName ?? null,
      })),
      addresses,
      following: buyer.follows.map((f) => f.seller),
      supportTickets,
      activity: {
        lastOrderAt: lastOrder?.createdAt ?? null,
        lastReplacementAt: lastReplacement?.createdAt ?? null,
      },
    };
  }

  async listSellerDirectory(q?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: Prisma.SellerWhereInput = q?.trim()
      ? {
          OR: [
            { businessName: { contains: q.trim(), mode: 'insensitive' } },
            {
              user: {
                OR: [
                  { email: { contains: q.trim(), mode: 'insensitive' } },
                  { phone: { contains: q.trim(), mode: 'insensitive' } },
                  { name: { contains: q.trim(), mode: 'insensitive' } },
                ],
              },
            },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.seller.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              name: true,
              email: true,
              phone: true,
              createdAt: true,
            },
          },
          rating: true,
        },
      }),
      this.prisma.seller.count({ where }),
    ]);

    const mapped = await Promise.all(
      items.map(async (s) => ({
        sellerId: s.id,
        businessName: s.businessName,
        status: s.status,
        ownerName: s.user.name,
        email: s.user.email,
        phone: s.user.phone,
        createdAt: s.user.createdAt,
        overall: s.rating?.overall ?? 5,
        replacementPercent: await this.ratings.getSellerReplacementPercent(s.id),
      })),
    );

    return { items: mapped, total, page, limit };
  }

  getSellerUserDetail(sellerId: string) {
    return this.getSellerDetail(sellerId);
  }

  async listPackingVideos(filter?: { sellerId?: string }) {
    const orders = await this.prisma.order.findMany({
      where: {
        packingVideoUrl: { not: null },
        ...(filter?.sellerId
          ? {
              items: {
                some: { product: { sellerId: filter.sellerId } },
              },
            }
          : {}),
      },
      orderBy: { packedAt: 'desc' },
      include: {
        items: { include: { product: { include: { seller: true } } } },
      },
      take: 200,
    });

    return orders.map((o) => {
      const seller = o.items[0]?.product?.seller ?? null;
      return {
        orderId: o.id,
        packedAt: o.packedAt,
        packingVideoUrl: o.packingVideoUrl,
        streamId: o.streamId,
        seller: seller
          ? { id: seller.id, businessName: seller.businessName, userId: seller.userId }
          : null,
      };
    });
  }
}
