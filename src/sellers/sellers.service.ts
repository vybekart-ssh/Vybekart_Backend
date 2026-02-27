import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSellerProfileDto } from './dto/update-seller-profile.dto';
import { UpdateBankDetailsDto } from './dto/bank-details.dto';
import { UpdateStoreDetailsDto } from './dto/store-details.dto';
import { UpdateSignatureDto } from './dto/signature.dto';
import { OrderStatus, VerificationStatus } from '@prisma/client';

@Injectable()
export class SellersService {
  constructor(private prisma: PrismaService) {}

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

    const [todayOrders, todayRevenue, totalOrders, nextStream] = await Promise.all([
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
      this.prisma.stream.findFirst({
        where: { sellerId: seller.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          description: true,
          isLive: true,
          startedAt: true,
          endedAt: true,
        },
      }),
    ]);

    const productCount = await this.prisma.product.count({
      where: { sellerId: seller.id },
    });

    return {
      productCount,
      sales: todayRevenue._sum?.totalAmount ?? 0,
      todayRevenue: todayRevenue._sum?.totalAmount ?? 0,
      todayOrders,
      totalOrders,
      liveViewersToday: 0,
      followers: 0,
      nextLiveSession: nextStream
        ? {
            id: nextStream.id,
            title: nextStream.title,
            description: nextStream.description,
            isLive: nextStream.isLive,
            startedAt: nextStream.startedAt,
            endedAt: nextStream.endedAt,
          }
        : null,
    };
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

  /** GET store details */
  async getStoreDetails(userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      include: {
        primaryCategory: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!seller) throw new NotFoundException('Seller profile not found');
    return {
      businessName: seller.businessName,
      businessAddress: seller.businessAddress,
      gstNumber: seller.gstNumber,
      primaryCategoryId: seller.primaryCategoryId,
      primaryCategory: seller.primaryCategory,
      description: seller.description,
      logoUrl: seller.logoUrl,
      bannerUrl: seller.bannerUrl,
    };
  }

  /** PUT store details */
  async updateStoreDetails(userId: string, dto: UpdateStoreDetailsDto) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller) throw new NotFoundException('Seller profile not found');
    return this.prisma.seller.update({
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
      },
      include: {
        primaryCategory: { select: { id: true, name: true, slug: true } },
      },
    });
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
