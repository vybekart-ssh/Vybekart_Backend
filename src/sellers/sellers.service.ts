import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { UpdateSellerProfileDto } from './dto/update-seller-profile.dto';
import { UpdateBankDetailsDto } from './dto/bank-details.dto';
import { UpdateStoreDetailsDto } from './dto/store-details.dto';
import { UpdateSignatureDto } from './dto/signature.dto';
import { OrderStatus, VerificationStatus } from '@prisma/client';

const STORE_IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

@Injectable()
export class SellersService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async findOne(userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        categories: {
          include: {
            category: { select: { id: true, name: true, slug: true } },
          },
        },
        products: { take: 50 },
        streams: { take: 20, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!seller) throw new NotFoundException('Seller profile not found');
    const pickupAddress = await this.prisma.address.findFirst({
      where: { userId, type: 'PICKUP' },
    });
    return { ...seller, pickupAddress: pickupAddress ?? null };
  }

  async updateProfile(userId: string, dto: UpdateSellerProfileDto) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller) throw new NotFoundException('Seller profile not found');

    return this.prisma.seller.update({
      where: { userId },
      data: {
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.bankAccount !== undefined && { bankAccount: dto.bankAccount }),
        ...(dto.ifscCode !== undefined && { ifscCode: dto.ifscCode }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
        ...(dto.bannerUrl !== undefined && { bannerUrl: dto.bannerUrl }),
      },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        categories: {
          include: {
            category: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
  }

  /** Admin: list sellers pending verification */
  async findPending() {
    return this.prisma.seller.findMany({
      where: { status: VerificationStatus.PENDING },
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
        categories: {
          include: {
            category: { select: { id: true, name: true, slug: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Admin: approve seller */
  async approve(sellerId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    if (seller.status !== VerificationStatus.PENDING) {
      throw new BadRequestException('Seller is not pending approval');
    }
    return this.prisma.seller.update({
      where: { id: sellerId },
      data: { status: VerificationStatus.VERIFIED, rejectionReason: null },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /** Admin: reject seller */
  async reject(sellerId: string, reason: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    if (seller.status !== VerificationStatus.PENDING) {
      throw new BadRequestException('Seller is not pending approval');
    }
    return this.prisma.seller.update({
      where: { id: sellerId },
      data: {
        status: VerificationStatus.REJECTED,
        rejectionReason: reason || 'Not approved',
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async getDashboardStats(sellerId: string) {
    const productCount = await this.prisma.product.count({
      where: { sellerId },
    });
    return { productCount, sales: 0 };
  }

  /** Seller: get dashboard stats (today revenue, today orders, total orders, placeholders for viewers/followers) */
  async getMyDashboardStats(userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller) throw new NotFoundException('Seller profile not found');

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const sellerOrderWhere = {
      items: { some: { product: { sellerId: seller.id } } },
      status: { in: ['PAID', 'SHIPPED', 'DELIVERED'] as OrderStatus[] },
    };

    const [todayOrders, todayRevenue, totalOrders] = await Promise.all([
      this.prisma.order.count({
        where: {
          ...sellerOrderWhere,
          createdAt: { gte: todayStart, lt: todayEnd },
        },
      }),
      this.prisma.order.aggregate({
        where: {
          ...sellerOrderWhere,
          createdAt: { gte: todayStart, lt: todayEnd },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.count({
        where: { items: { some: { product: { sellerId: seller.id } } } },
      }),
    ]);

    const upcomingScheduled = await this.getUpcomingScheduledStreams(seller.id);
    const liveNow = await this.getActiveLiveStream(seller.id);

    const productCount = await this.prisma.product.count({
      where: { sellerId: seller.id },
    });

    const { revenueLast7Days, ordersLast7Days } =
      await this.getLast7DaysChartSeries(sellerOrderWhere);

    const mapSession = (s: {
      id: string;
      title: string;
      description: string | null;
      isLive: boolean;
      startedAt: Date | null;
      endedAt: Date | null;
      thumbnailUrl: string | null;
    }) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      isLive: s.isLive,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      thumbnailUrl: s.thumbnailUrl,
    });

    return {
      productCount,
      sales: todayRevenue._sum?.totalAmount ?? 0,
      todayRevenue: todayRevenue._sum?.totalAmount ?? 0,
      todayOrders,
      totalOrders,
      liveViewersToday: 0,
      followers: 0,
      revenueLast7Days,
      ordersLast7Days,
      /** All future scheduled streams (not yet live), oldest first */
      scheduledLiveSessions: upcomingScheduled.map(mapSession),
      /** Currently live stream (if any) */
      activeLiveSession: liveNow ? mapSession(liveNow) : null,
      /** @deprecated First scheduled session only — use `scheduledLiveSessions` */
      nextLiveSession: upcomingScheduled[0] ? mapSession(upcomingScheduled[0]) : null,
    };
  }

  /** Scheduled streams not yet live: future slots, or overdue within a 4h grace window */
  private async getUpcomingScheduledStreams(sellerId: string) {
    const select = {
      id: true,
      title: true,
      description: true,
      isLive: true,
      startedAt: true,
      endedAt: true,
      thumbnailUrl: true,
    } as const;
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);
    return this.prisma.stream.findMany({
      where: {
        sellerId,
        endedAt: null,
        isLive: false,
        startedAt: { gte: cutoff },
      },
      orderBy: { startedAt: 'asc' },
      select,
    });
  }

  /** Seller’s current live stream (if any) */
  private async getActiveLiveStream(sellerId: string) {
    const select = {
      id: true,
      title: true,
      description: true,
      isLive: true,
      startedAt: true,
      endedAt: true,
      thumbnailUrl: true,
    } as const;
    return this.prisma.stream.findFirst({
      where: { sellerId, endedAt: null, isLive: true },
      orderBy: { startedAt: 'desc' },
      select,
    });
  }

  /** Last 7 calendar days (oldest → newest) for dashboard charts */
  private async getLast7DaysChartSeries(sellerOrderWhere: {
    items: { some: { product: { sellerId: string } } };
    status: { in: OrderStatus[] };
  }) {
    const now = new Date();
    const revenueLast7Days: { dayLabel: string; amount: number }[] = [];
    const ordersLast7Days: { dayLabel: string; count: number }[] = [];

    for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
      const dayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - dayOffset,
      );
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      const [revAgg, ordCount] = await Promise.all([
        this.prisma.order.aggregate({
          where: {
            ...sellerOrderWhere,
            createdAt: { gte: dayStart, lt: dayEnd },
          },
          _sum: { totalAmount: true },
        }),
        this.prisma.order.count({
          where: {
            ...sellerOrderWhere,
            createdAt: { gte: dayStart, lt: dayEnd },
          },
        }),
      ]);

      const dayLabel = dayStart.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
      });
      revenueLast7Days.push({
        dayLabel,
        amount: Number(revAgg._sum?.totalAmount ?? 0),
      });
      ordersLast7Days.push({
        dayLabel,
        count: ordCount,
      });
    }

    return { revenueLast7Days, ordersLast7Days };
  }

  /** GET /sellers/revenue/today - today's revenue and comparison with yesterday */
  async getRevenueToday(userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller) throw new NotFoundException('Seller profile not found');

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

    const baseWhere = {
      items: { some: { product: { sellerId: seller.id } } },
      status: { in: ['PAID', 'SHIPPED', 'DELIVERED'] as OrderStatus[] },
    };

    const [todayAgg, yesterdayAgg] = await Promise.all([
      this.prisma.order.aggregate({
        where: { ...baseWhere, createdAt: { gte: todayStart, lt: todayEnd } },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.aggregate({
        where: {
          ...baseWhere,
          createdAt: { gte: yesterdayStart, lt: todayStart },
        },
        _sum: { totalAmount: true },
      }),
    ]);

    const today = todayAgg._sum?.totalAmount ?? 0;
    const yesterday = yesterdayAgg._sum?.totalAmount ?? 0;
    const changePercent =
      yesterday > 0 ? (((today - yesterday) / yesterday) * 100) : today > 0 ? 100 : 0;

    return {
      total: today,
      changePercentVsYesterday: Math.round(changePercent * 10) / 10,
      flowData: [],
      breakdown: [],
    };
  }

  /** GET bank details (account number masked) */
  async getBankDetails(userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      select: {
        bankName: true,
        accountHolderName: true,
        bankAccount: true,
        ifscCode: true,
        accountType: true,
      },
    });
    if (!seller) throw new NotFoundException('Seller profile not found');
    const maskedAccount = seller.bankAccount
      ? 'xxxx' + seller.bankAccount.slice(-5)
      : null;
    return {
      bankName: seller.bankName,
      accountHolderName: seller.accountHolderName,
      accountNumber: maskedAccount,
      ifscCode: seller.ifscCode,
      accountType: seller.accountType,
    };
  }

  /** PUT bank details */
  async updateBankDetails(userId: string, dto: UpdateBankDetailsDto) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller) throw new NotFoundException('Seller profile not found');
    return this.prisma.seller.update({
      where: { userId },
      data: {
        ...(dto.bankName !== undefined && { bankName: dto.bankName }),
        ...(dto.accountHolderName !== undefined && {
          accountHolderName: dto.accountHolderName,
        }),
        ...(dto.bankAccount !== undefined && { bankAccount: dto.bankAccount }),
        ...(dto.ifscCode !== undefined && { ifscCode: dto.ifscCode }),
        ...(dto.accountType !== undefined && { accountType: dto.accountType }),
      },
      select: {
        bankName: true,
        accountHolderName: true,
        ifscCode: true,
        accountType: true,
      },
    });
  }

  private formatPickupAddressRecord(a: {
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    zip: string;
    country: string;
  }): string {
    const parts = [
      a.line1.trim(),
      a.line2?.trim(),
      `${a.city.trim()}, ${a.state.trim()} ${a.zip.trim()}`,
      a.country.trim(),
    ].filter((x) => x && x.length > 0);
    return parts.join(', ');
  }

  /** GET store details */
  async getStoreDetails(userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      include: {
        primaryCategory: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!seller) throw new NotFoundException('Seller profile not found');

    let businessAddress =
      seller.businessAddress?.trim() ? seller.businessAddress : null;
    if (!businessAddress) {
      const pickup =
        (await this.prisma.address.findFirst({
          where: { userId, type: 'PICKUP', isDefault: true },
        })) ??
        (await this.prisma.address.findFirst({
          where: { userId, type: 'PICKUP' },
        }));
      if (pickup) {
        businessAddress = this.formatPickupAddressRecord(pickup);
      }
    }

    return {
      businessName: seller.businessName,
      businessAddress,
      gstNumber: seller.gstNumber,
      primaryCategoryId: seller.primaryCategoryId,
      primaryCategory: seller.primaryCategory,
      description: seller.description,
      logoUrl: seller.logoUrl,
      bannerUrl: seller.bannerUrl,
      websiteUrl: seller.websiteUrl,
    };
  }

  /** PATCH store details */
  async updateStoreDetails(userId: string, dto: UpdateStoreDetailsDto) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller) throw new NotFoundException('Seller profile not found');
    await this.prisma.seller.update({
      where: { userId },
      data: {
        ...(dto.businessName !== undefined && { businessName: dto.businessName }),
        ...(dto.businessAddress !== undefined && {
          businessAddress: dto.businessAddress,
        }),
        ...(dto.gstNumber !== undefined && { gstNumber: dto.gstNumber }),
        ...(dto.primaryCategoryId !== undefined && {
          primaryCategoryId: dto.primaryCategoryId,
        }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
        ...(dto.bannerUrl !== undefined && { bannerUrl: dto.bannerUrl }),
        ...(dto.websiteUrl !== undefined && {
          websiteUrl: dto.websiteUrl?.trim() || null,
        }),
      },
    });
    return this.getStoreDetails(userId);
  }

  async uploadStoreLogo(userId: string, file: Express.Multer.File) {
    return this.saveStoreImage(userId, file, 'logo');
  }

  async uploadStoreBanner(userId: string, file: Express.Multer.File) {
    return this.saveStoreImage(userId, file, 'banner');
  }

  private async saveStoreImage(
    userId: string,
    file: Express.Multer.File,
    kind: 'logo' | 'banner',
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Image file is required');
    }
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller) throw new NotFoundException('Seller profile not found');
    const mime = (file.mimetype ?? '').toLowerCase();
    const ext = STORE_IMAGE_MIME_EXT[mime];
    if (!ext) {
      throw new BadRequestException(
        'Image must be JPEG, PNG, WebP, or GIF',
      );
    }
    const dir = path.join(process.cwd(), 'uploads', 'store', seller.id);
    await fs.mkdir(dir, { recursive: true });
    const fname = `${kind}-${Date.now()}${ext}`;
    const dest = path.join(dir, fname);
    await fs.writeFile(dest, file.buffer);
    const publicBase =
      this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:3000';
    const base = publicBase.replace(/\/$/, '');
    const url = `${base}/uploads/store/${seller.id}/${fname}`;
    return kind === 'logo' ? { logoUrl: url } : { bannerUrl: url };
  }

  /** GET signature URL */
  async getSignature(userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      select: { signatureUrl: true },
    });
    if (!seller) throw new NotFoundException('Seller profile not found');
    return { signatureUrl: seller.signatureUrl };
  }

  /** PUT signature (save) */
  async updateSignature(userId: string, dto: UpdateSignatureDto) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller) throw new NotFoundException('Seller profile not found');
    return this.prisma.seller.update({
      where: { userId },
      data: {
        ...(dto.signatureUrl !== undefined && {
          signatureUrl: dto.signatureUrl,
        }),
      },
      select: { signatureUrl: true },
    });
  }
}
