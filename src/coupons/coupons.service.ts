import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Coupon,
  CouponDiscountType,
  CouponVisibility,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type CouponSafePublic = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
};

export type CouponValidateResult = {
  valid: boolean;
  code: string;
  title: string;
  discountType: CouponDiscountType;
  discountValue: number;
  discountAmount: number;
  minOrderAmount: number;
  eligibleBase: number;
  message?: string;
};

type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  normalizeCode(code: string): string {
    return (code ?? '').trim().toUpperCase();
  }

  private publicSelect = {
    id: true,
    code: true,
    title: true,
    description: true,
    discountType: true,
    discountValue: true,
    maxDiscountAmount: true,
    minOrderAmount: true,
  } as const;

  async listPublicActive(): Promise<CouponSafePublic[]> {
    const now = new Date();
    const rows = await this.prisma.coupon.findMany({
      where: {
        visibility: CouponVisibility.PUBLIC,
        isActive: true,
        redeemedAt: null,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      select: this.publicSelect,
      orderBy: { createdAt: 'desc' },
    });
    return rows;
  }

  async findActiveByCode(code: string): Promise<Coupon> {
    const normalized = this.normalizeCode(code);
    if (!normalized) {
      throw new BadRequestException('Coupon code is required');
    }
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: normalized },
    });
    if (!coupon) {
      throw new BadRequestException('Invalid coupon code');
    }
    return coupon;
  }

  /** Discount in ₹ for eligibleBase = subtotal + buyerDeliveryFee. */
  computeDiscount(coupon: Coupon, eligibleBase: number): number {
    const base = Math.max(0, eligibleBase);
    let discount = 0;
    if (coupon.discountType === CouponDiscountType.FLAT) {
      discount = coupon.discountValue;
    } else {
      discount = (base * coupon.discountValue) / 100;
      if (
        coupon.maxDiscountAmount != null &&
        coupon.maxDiscountAmount > 0 &&
        discount > coupon.maxDiscountAmount
      ) {
        discount = coupon.maxDiscountAmount;
      }
    }
    discount = Math.round(discount * 100) / 100;
    if (discount < 0) discount = 0;
    if (discount > base) discount = base;
    return discount;
  }

  assertApplicable(coupon: Coupon, eligibleBase: number): void {
    if (!coupon.isActive) {
      throw new BadRequestException('This coupon is no longer active');
    }
    if (coupon.redeemedAt != null || coupon.redeemedOrderId != null) {
      throw new BadRequestException('This coupon has already been used');
    }
    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) {
      throw new BadRequestException('This coupon is not valid yet');
    }
    if (coupon.endsAt && coupon.endsAt < now) {
      throw new BadRequestException('This coupon has expired');
    }
    if (coupon.discountValue <= 0) {
      throw new BadRequestException('This coupon is invalid');
    }
    if (
      coupon.discountType === CouponDiscountType.PERCENT &&
      coupon.discountValue > 100
    ) {
      throw new BadRequestException('This coupon is invalid');
    }
    const min = coupon.minOrderAmount ?? 0;
    if (eligibleBase < min) {
      throw new BadRequestException(
        `Minimum order amount for this coupon is ₹${min}`,
      );
    }
  }

  /**
   * Atomically burn a one-time coupon. Fails if already redeemed.
   * Call only when the order is marked PAID.
   */
  async burnOnPaidOrder(
    db: DbClient,
    couponId: string,
    orderId: string,
  ): Promise<void> {
    const result = await db.coupon.updateMany({
      where: { id: couponId, redeemedAt: null },
      data: {
        redeemedAt: new Date(),
        redeemedOrderId: orderId,
      },
    });
    if (result.count === 0) {
      throw new BadRequestException(
        'This coupon was already used by another order',
      );
    }
  }

  async validateAgainstEligibleBase(
    code: string,
    eligibleBase: number,
  ): Promise<CouponValidateResult> {
    try {
      const coupon = await this.findActiveByCode(code);
      this.assertApplicable(coupon, eligibleBase);
      const discountAmount = this.computeDiscount(coupon, eligibleBase);
      return {
        valid: true,
        code: coupon.code,
        title: coupon.title,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        discountAmount,
        minOrderAmount: coupon.minOrderAmount,
        eligibleBase,
      };
    } catch (err) {
      let message = 'Invalid coupon';
      if (err instanceof BadRequestException || err instanceof NotFoundException) {
        const res = err.getResponse();
        if (typeof res === 'string') message = res;
        else if (res && typeof res === 'object' && 'message' in res) {
          const m = (res as { message?: string | string[] }).message;
          message = Array.isArray(m) ? m.join(', ') : (m ?? err.message);
        } else {
          message = err.message;
        }
      } else if (err instanceof Error) {
        message = err.message;
      }
      return {
        valid: false,
        code: this.normalizeCode(code),
        title: '',
        discountType: CouponDiscountType.FLAT,
        discountValue: 0,
        discountAmount: 0,
        minOrderAmount: 0,
        eligibleBase,
        message,
      };
    }
  }

  /**
   * Re-check a pending coupon at payment verify time.
   * Throws BadRequest if no longer applicable (triggers refund path).
   */
  async assertStillApplicableForPending(params: {
    couponCode: string;
    couponId?: string | null;
    expectedDiscount?: number | null;
    subtotal: number;
    buyerDeliveryFee: number;
  }): Promise<Coupon> {
    const coupon = await this.findActiveByCode(params.couponCode);
    if (params.couponId && coupon.id !== params.couponId) {
      throw new BadRequestException('Coupon no longer matches this payment');
    }
    const eligibleBase = params.subtotal + params.buyerDeliveryFee;
    this.assertApplicable(coupon, eligibleBase);
    if (
      params.expectedDiscount != null &&
      Math.abs(
        this.computeDiscount(coupon, eligibleBase) - params.expectedDiscount,
      ) > 0.05
    ) {
      throw new BadRequestException(
        'Coupon discount changed. Please try checkout again.',
      );
    }
    return coupon;
  }
}
