import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  RatingEntityType,
  ReplacementStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SubmitSellerRatingDto } from './dto/submit-seller-rating.dto';
import { PatchBuyerRatingDto } from './dto/patch-buyer-rating.dto';
import { PatchSellerRatingDto } from './dto/patch-seller-rating.dto';

const QUALIFIED_DAY_SECONDS = 30 * 60;
const REWARD_DAYS_REQUIRED = 10;
const REWARD_WINDOW_DAYS = 30;

@Injectable()
export class RatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async ensureBuyerRating(buyerId: string) {
    return this.prisma.buyerRating.upsert({
      where: { buyerId },
      create: { buyerId },
      update: {},
    });
  }

  async ensureSellerRating(sellerId: string) {
    return this.prisma.sellerRating.upsert({
      where: { sellerId },
      create: { sellerId },
      update: {},
    });
  }

  async getBuyerScore(buyerId: string): Promise<number> {
    const row = await this.ensureBuyerRating(buyerId);
    return row.score;
  }

  async getSellerPublic(sellerId: string) {
    const rating = await this.ensureSellerRating(sellerId);
    const replacementPercent =
      await this.getSellerReplacementPercent(sellerId);
    return {
      sellerId,
      overall: rating.overall,
      quality: rating.quality,
      originality: rating.originality,
      valueForMoney: rating.valueForMoney,
      replacementPercent,
    };
  }

  async getSellerReplacementPercent(sellerId: string): Promise<number> {
    const fulfilled = await this.prisma.order.count({
      where: {
        status: OrderStatus.DELIVERED,
        items: { some: { product: { sellerId } } },
      },
    });
    if (fulfilled === 0) return 0;
    const approved = await this.prisma.replacementRequest.count({
      where: {
        sellerId,
        status: {
          in: [
            ReplacementStatus.APPROVED,
            ReplacementStatus.SHIPPED,
            ReplacementStatus.DELIVERED,
          ],
        },
      },
    });
    return Math.round((approved / fulfilled) * 1000) / 10;
  }

  async submitSellerRating(userId: string, dto: SubmitSellerRatingDto) {
    const buyer = await this.prisma.buyer.findUnique({ where: { userId } });
    if (!buyer) throw new NotFoundException('Buyer profile not found');

    const order = await this.prisma.order.findFirst({
      where: {
        id: dto.orderId,
        buyerId: buyer.id,
        status: OrderStatus.DELIVERED,
      },
      include: { items: { include: { product: true } } },
    });
    if (!order) {
      throw new BadRequestException('Delivered order not found');
    }
    const sellerId = order.items[0]?.product?.sellerId;
    if (!sellerId) throw new BadRequestException('Seller not found for order');

    const overall =
      (dto.quality + dto.originality + dto.valueForMoney) / 3;

    const updated = await this.prisma.sellerRating.upsert({
      where: { sellerId },
      create: {
        sellerId,
        overall,
        quality: dto.quality,
        originality: dto.originality,
        valueForMoney: dto.valueForMoney,
      },
      update: {
        overall,
        quality: dto.quality,
        originality: dto.originality,
        valueForMoney: dto.valueForMoney,
      },
    });

    return updated;
  }

  async adminPatchBuyerRating(
    buyerId: string,
    adminUserId: string,
    dto: PatchBuyerRatingDto,
  ) {
    const existing = await this.ensureBuyerRating(buyerId);
    await this.logOverride(
      adminUserId,
      RatingEntityType.BUYER,
      buyerId,
      'score',
      existing.score,
      dto.score,
      dto.reason,
    );
    return this.prisma.buyerRating.update({
      where: { buyerId },
      data: { score: dto.score },
    });
  }

  async adminPatchSellerRating(
    sellerId: string,
    adminUserId: string,
    dto: PatchSellerRatingDto,
  ) {
    const existing = await this.ensureSellerRating(sellerId);
    const data: Prisma.SellerRatingUpdateInput = {};
    const fields = [
      'overall',
      'quality',
      'originality',
      'valueForMoney',
    ] as const;
    for (const f of fields) {
      const v = dto[f];
      if (v !== undefined && v !== null) {
        data[f] = v;
        await this.logOverride(
          adminUserId,
          RatingEntityType.SELLER,
          sellerId,
          f,
          existing[f],
          v,
          dto.reason,
        );
      }
    }
    return this.prisma.sellerRating.update({
      where: { sellerId },
      data,
    });
  }

  async onReplacementRequested(buyerId: string, sellerId: string) {
    const buyerRating = await this.ensureBuyerRating(buyerId);
    await this.prisma.buyerRating.update({
      where: { buyerId },
      data: { replacementCount: { increment: 1 } },
    });

    const since90 = new Date();
    since90.setDate(since90.getDate() - 90);
    const buyerRequests90 = await this.prisma.replacementRequest.count({
      where: { buyerId, createdAt: { gte: since90 } },
    });
    if (buyerRequests90 >= 3) {
      const newScore = Math.max(0, buyerRating.score - 2);
      await this.prisma.buyerRating.update({
        where: { buyerId },
        data: { score: newScore },
      });
      const buyer = await this.prisma.buyer.findUnique({
        where: { id: buyerId },
        include: { user: { select: { email: true, name: true } } },
      });
      if (buyer?.user.email) {
        await this.mail.sendToBuyer(buyer.user.email, {
          subject: 'VybeKart — replacement activity notice',
          text: `Hi ${buyer.user.name},\n\nWe recorded multiple replacement requests on your account. Our team may review future requests more closely.\n\n— VybeKart`,
        });
      }
    }

    const since30 = new Date();
    since30.setDate(since30.getDate() - 30);
    const sellerRequests30 = await this.prisma.replacementRequest.count({
      where: { sellerId, createdAt: { gte: since30 } },
    });
    if (sellerRequests30 >= 5) {
      const sellerRating = await this.ensureSellerRating(sellerId);
      const newOverall = Math.max(0, sellerRating.overall - 2);
      await this.prisma.sellerRating.update({
        where: { sellerId },
        data: { overall: newOverall },
      });
      await this.mail.sendToSupport({
        subject: `Seller replacement threshold — ${sellerId}`,
        text: `Seller ${sellerId} has ${sellerRequests30} replacement requests in 30 days. Overall rating reduced to ${newOverall}.`,
      });
    }
  }

  async recordDeliveredOrder(buyerId: string) {
    await this.ensureBuyerRating(buyerId);
    await this.prisma.buyerRating.update({
      where: { buyerId },
      data: { deliveredCount: { increment: 1 } },
    });
  }

  private async logOverride(
    adminUserId: string,
    entityType: RatingEntityType,
    entityId: string,
    field: string,
    oldValue: number,
    newValue: number,
    reason?: string,
  ) {
    await this.prisma.ratingOverrideLog.create({
      data: {
        adminUserId,
        entityType,
        entityId,
        field,
        oldValue,
        newValue,
        reason: reason ?? null,
      },
    });
  }

  istDateOnly(d: Date = new Date()): Date {
    const ist = new Date(
      d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }),
    );
    return new Date(Date.UTC(ist.getFullYear(), ist.getMonth(), ist.getDate()));
  }

  async recordStreamDuration(sellerId: string, durationSeconds: number) {
    const day = this.istDateOnly();
    const existing = await this.prisma.sellerLiveQualificationDay.findUnique({
      where: { sellerId_date: { sellerId, date: day } },
    });
    const totalSeconds = (existing?.totalSeconds ?? 0) + durationSeconds;
    const qualified = totalSeconds >= QUALIFIED_DAY_SECONDS;
    await this.prisma.sellerLiveQualificationDay.upsert({
      where: { sellerId_date: { sellerId, date: day } },
      create: { sellerId, date: day, totalSeconds, qualified },
      update: { totalSeconds, qualified },
    });
    return this.refreshCommissionWaiver(sellerId);
  }

  async getLiveRewardStatus(sellerId: string) {
    const day = this.istDateOnly();
    const today = await this.prisma.sellerLiveQualificationDay.findUnique({
      where: { sellerId_date: { sellerId, date: day } },
    });
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - REWARD_WINDOW_DAYS);
    const qualifiedDays = await this.prisma.sellerLiveQualificationDay.count({
      where: {
        sellerId,
        qualified: true,
        date: { gte: windowStart },
      },
    });
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { commissionWaiverActive: true },
    });
    return {
      minutesToday: Math.floor((today?.totalSeconds ?? 0) / 60),
      minutesRequiredToday: 30,
      qualifiedDaysInWindow: qualifiedDays,
      qualifiedDaysRequired: REWARD_DAYS_REQUIRED,
      windowDays: REWARD_WINDOW_DAYS,
      rewardActive: qualifiedDays >= REWARD_DAYS_REQUIRED,
      commissionWaiverActive: seller?.commissionWaiverActive ?? false,
    };
  }

  async refreshCommissionWaiver(sellerId: string) {
    const status = await this.getLiveRewardStatus(sellerId);
    await this.prisma.seller.update({
      where: { id: sellerId },
      data: { commissionWaiverActive: status.rewardActive },
    });
    return status;
  }
}
