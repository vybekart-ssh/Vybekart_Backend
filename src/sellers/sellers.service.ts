import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSellerProfileDto } from './dto/update-seller-profile.dto';
import { UpdateBankDetailsDto } from './dto/bank-details.dto';
import { UpdateStoreDetailsDto } from './dto/store-details.dto';
import { UpdateSignatureDto } from './dto/signature.dto';
import { UpdatePickupAddressDto } from './dto/pickup-address.dto';
import { AddressType } from '@prisma/client';
import { OrderStatus, VerificationStatus } from '@prisma/client';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { FirebasePushService } from '../notifications/firebase-push.service';

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
    private supabaseStorage: SupabaseStorageService,
    private firebasePush: FirebasePushService,
  ) {}

  private async bestEffortPushToSellerUser(
    userId: string,
    title: string,
    body: string,
    data: Record<string, string>,
  ) {
    try {
      const devices = await this.prisma.userPushDevice.findMany({
        where: { userId },
        select: { fcmToken: true },
      });
      const tokens = devices.map((d) => d.fcmToken).filter(Boolean);
      await this.firebasePush.sendToTokensBatched(tokens, title, body, data);
    } catch {
      // best-effort: never fail the main workflow
    }
  }

  async findOne(userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        changeRequests: { take: 1, orderBy: { createdAt: 'desc' } },
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
    const latestChangeRequest = seller.changeRequests[0] ?? null;
    // Remove the relation array from the response to keep payload small/stable.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { changeRequests, ...sellerRest } = seller;
    return {
      ...sellerRest,
      pickupAddress: pickupAddress ?? null,
      latestChangeRequest,
    };
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

  /** Admin: list sellers (optional status filter) */
  async findAllForAdmin(status?: VerificationStatus) {
    return this.prisma.seller.findMany({
      where: status ? { status } : undefined,
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
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** Admin: full seller detail for review */
  async findOneSellerForAdmin(sellerId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
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
        changeRequests: { take: 10, orderBy: { createdAt: 'desc' } },
        categories: {
          include: {
            category: { select: { id: true, name: true, slug: true } },
          },
        },
        primaryCategory: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    const pickupAddresses = await this.prisma.address.findMany({
      where: { userId: seller.userId, type: 'PICKUP' },
    });
    return { ...seller, pickupAddresses };
  }

  /** Admin: approve seller */
  async approve(sellerId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    if (
      seller.status !== VerificationStatus.PENDING &&
      seller.status !== VerificationStatus.REJECTED &&
      seller.status !== VerificationStatus.NEEDS_CHANGES
    ) {
      throw new BadRequestException(
        'Seller can only be approved when pending, rejected, or needs changes',
      );
    }
    const updated = await this.prisma.seller.update({
      where: { id: sellerId },
      data: { status: VerificationStatus.VERIFIED, rejectionReason: null },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
    await this.bestEffortPushToSellerUser(
      updated.userId,
      'Seller verification approved',
      'Your seller account is verified. You can now start selling on VybeKart.',
      { type: 'SELLER_VERIFICATION', status: 'VERIFIED', sellerId },
    );
    return updated;
  }

  /** Admin: reject / deny seller (final rejection) */
  async reject(sellerId: string, reason: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    if (
      seller.status !== VerificationStatus.PENDING &&
      seller.status !== VerificationStatus.VERIFIED &&
      seller.status !== VerificationStatus.NEEDS_CHANGES
    ) {
      throw new BadRequestException('Seller cannot be rejected in this state');
    }
    const updated = await this.prisma.seller.update({
      where: { id: sellerId },
      data: {
        status: VerificationStatus.REJECTED,
        rejectionReason: reason || 'Not approved',
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
    await this.bestEffortPushToSellerUser(
      updated.userId,
      'Seller verification rejected',
      updated.rejectionReason ?? 'Your seller application was rejected.',
      { type: 'SELLER_VERIFICATION', status: 'REJECTED', sellerId },
    );
    return updated;
  }

  /** Admin: request changes (guided) */
  async requestChanges(input: {
    sellerId: string;
    adminUserId: string;
    sections: string[];
    note?: string;
  }) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: input.sellerId },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    if (
      seller.status !== VerificationStatus.PENDING &&
      seller.status !== VerificationStatus.VERIFIED
    ) {
      throw new BadRequestException(
        'Seller cannot be marked as needs-changes in this state',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.seller.update({
        where: { id: input.sellerId },
        data: {
          status: VerificationStatus.NEEDS_CHANGES,
        },
      });

      await tx.sellerChangeRequest.create({
        data: {
          sellerId: input.sellerId,
          createdByAdminId: input.adminUserId,
          note: input.note?.trim() ? input.note.trim() : null,
          sections: input.sections,
          statusAtCreation: seller.status,
        },
      });
    });

    await this.bestEffortPushToSellerUser(
      seller.userId,
      'Changes requested',
      input.note?.trim()
        ? input.note.trim()
        : 'VybeKart has requested changes to your seller onboarding details.',
      {
        type: 'SELLER_VERIFICATION',
        status: 'NEEDS_CHANGES',
        sellerId: input.sellerId,
      },
    );

    return this.findOneSellerForAdmin(input.sellerId);
  }

  /** Seller: resubmit after NEEDS_CHANGES */
  async resubmitForReview(userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      include: {
        categories: { select: { categoryId: true } },
      },
    });
    if (!seller) throw new NotFoundException('Seller profile not found');
    if (seller.status !== VerificationStatus.NEEDS_CHANGES) {
      throw new BadRequestException('Resubmission is only allowed in needs-changes');
    }

    const pickupAddress = await this.prisma.address.findFirst({
      where: { userId, type: AddressType.PICKUP },
    });

    const missing: string[] = [];
    if (!seller.businessName?.trim()) missing.push('businessName');
    if (!seller.businessAddress?.trim()) missing.push('businessAddress');
    if (!seller.primaryCategoryId?.trim()) missing.push('primaryCategoryId');
    if (seller.categories.length === 0) missing.push('categories');
    if (!pickupAddress) missing.push('pickupAddress');
    if (!seller.bankName?.trim()) missing.push('bankName');
    if (!seller.accountHolderName?.trim()) missing.push('accountHolderName');
    if (!seller.bankAccount?.trim()) missing.push('bankAccount');
    if (!seller.ifscCode?.trim()) missing.push('ifscCode');
    if (!seller.accountType?.trim()) missing.push('accountType');
    if (!seller.signatureUrl?.trim()) missing.push('signatureUrl');

    if (missing.length) {
      throw new BadRequestException(
        `Please complete seller onboarding before resubmitting: ${missing.join(', ')}`,
      );
    }

    return this.prisma.seller.update({
      where: { userId },
      data: {
        status: VerificationStatus.PENDING,
        rejectionReason: null,
      },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    });
  }

  /**
   * Admin: clear onboarding/business data so the partner can complete registration again.
   * Does not delete products or the user account.
   */
  async reregisterSeller(sellerId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    const userId = seller.userId;
    await this.prisma.$transaction(async (tx) => {
      await tx.sellerCategory.deleteMany({ where: { sellerId } });
      await tx.address.deleteMany({ where: { userId, type: 'PICKUP' } });
      await tx.seller.update({
        where: { id: sellerId },
        data: {
          businessName: 'Pending re-registration',
          description: null,
          logoUrl: null,
          bannerUrl: null,
          websiteUrl: null,
          gstNumber: null,
          businessAddress: null,
          primaryCategoryId: null,
          bankAccount: null,
          bankName: null,
          accountHolderName: null,
          accountType: null,
          ifscCode: null,
          signatureUrl: null,
          status: VerificationStatus.PENDING,
          rejectionReason:
            'Your registration was reset by VybeKart. Please complete seller onboarding again in the app.',
        },
      });
    });
    return this.findOneSellerForAdmin(sellerId);
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
    const lines = [
      a.line1.trim(),
      a.line2?.trim(),
      `${a.city.trim()}, ${a.state.trim()} ${a.zip.trim()}`,
      a.country.trim(),
    ].filter((x) => x && x.length > 0);
    return lines.join('\n');
  }

  /** GET store details */
  async getStoreDetails(userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      include: {
        primaryCategory: { select: { id: true, name: true, slug: true } },
        categories: {
          include: {
            category: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
    if (!seller) throw new NotFoundException('Seller profile not found');
    if (!seller.primaryCategoryId && seller.categories.length > 0) {
      const row = seller.categories[0];
      const fillId = row.categoryId;
      await this.prisma.seller.update({
        where: { userId },
        data: { primaryCategoryId: fillId },
      });
      seller.primaryCategoryId = fillId;
      seller.primaryCategory = row.category;
    }

    const primaryCategoryId = seller.primaryCategoryId;
    const primaryCategory = seller.primaryCategory;

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

    const pickup = await this.prisma.address.findFirst({
      where: { userId, type: AddressType.PICKUP },
      orderBy: { createdAt: 'desc' },
    });

    return {
      businessName: seller.businessName,
      businessAddress,
      gstNumber: seller.gstNumber,
      primaryCategoryId,
      primaryCategory,
      description: seller.description,
      logoUrl: seller.logoUrl,
      bannerUrl: seller.bannerUrl,
      websiteUrl: seller.websiteUrl,
      pickupAddress: pickup
        ? {
            id: pickup.id,
            line1: pickup.line1,
            line2: pickup.line2,
            city: pickup.city,
            state: pickup.state,
            zip: pickup.zip,
            country: pickup.country,
          }
        : null,
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
          primaryCategoryId: dto.primaryCategoryId?.trim() || null,
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
    const bucket = this.supabaseStorage.publicBucket();
    const fname = `${kind}-${Date.now()}${ext}`;
    const objectKey = `vybekart-images/store/${seller.id}/${fname}`;
    const { publicUrl: url } = await this.supabaseStorage.uploadPublicObject({
      bucket,
      objectKey,
      contentType: mime,
      bytes: file.buffer,
      cacheControlSeconds: 60 * 60 * 24 * 30,
      upsert: true,
    });
    await this.prisma.seller.update({
      where: { id: seller.id },
      data:
        kind === 'logo'
          ? { logoUrl: url }
          : { bannerUrl: url },
    });
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

  async getPickupAddress(userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('Seller profile not found');
    const pickup = await this.prisma.address.findFirst({
      where: { userId, type: AddressType.PICKUP },
      orderBy: { createdAt: 'desc' },
    });
    return pickup
      ? {
          id: pickup.id,
          line1: pickup.line1,
          line2: pickup.line2,
          city: pickup.city,
          state: pickup.state,
          zip: pickup.zip,
          country: pickup.country,
        }
      : null;
  }

  async updatePickupAddress(userId: string, dto: UpdatePickupAddressDto) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('Seller profile not found');

    const country = dto.country?.trim() || 'IN';
    const existing = await this.prisma.address.findFirst({
      where: { userId, type: AddressType.PICKUP },
      orderBy: { createdAt: 'desc' },
    });

    const next = existing
      ? await this.prisma.address.update({
          where: { id: existing.id },
          data: {
            line1: dto.line1.trim(),
            line2: dto.line2?.trim() || null,
            city: dto.city.trim(),
            state: dto.state.trim(),
            zip: dto.zip.trim(),
            country,
            isDefault: true,
          },
        })
      : await this.prisma.address.create({
          data: {
            userId,
            type: AddressType.PICKUP,
            isDefault: true,
            line1: dto.line1.trim(),
            line2: dto.line2?.trim() || null,
            city: dto.city.trim(),
            state: dto.state.trim(),
            zip: dto.zip.trim(),
            country,
          },
        });

    // Backward compatibility: keep Seller.businessAddress in sync for existing clients
    const legacy = `${next.line1}${next.line2 ? ', ' + next.line2 : ''}, ${next.city}, ${next.state} ${next.zip}`;
    await this.prisma.seller.update({
      where: { userId },
      data: { businessAddress: legacy },
    });

    return {
      id: next.id,
      line1: next.line1,
      line2: next.line2,
      city: next.city,
      state: next.state,
      zip: next.zip,
      country: next.country,
    };
  }
}
