import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Razorpay from 'razorpay';
import * as crypto from 'crypto';
import { RedisService } from '../redis/redis.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRazorpayOrderDto } from './dto/create-razorpay-order.dto';
import { VerifyRazorpayPaymentDto } from './dto/verify-razorpay-payment.dto';

const PENDING_TTL_SECONDS = 30 * 60;

type PendingPayment = {
  userId: string;
  addressId: string;
  shippingAddress: string;
  amountPaise: number;
  subtotal: number;
  deliveryFee: number;
  deliveryProvider: string | null;
  streamId: string;
};

type RefundAttempt = {
  status: 'REFUNDED' | 'REFUND_FAILED';
  refundId?: string;
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly razorpay: Razorpay | null;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly orders: OrdersService,
    private readonly prisma: PrismaService,
  ) {
    const keyId = this.config.get<string>('RAZORPAY_KEY_ID')?.trim();
    const keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET')?.trim();
    if (keyId && keySecret) {
      this.razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    } else {
      this.razorpay = null;
    }
  }

  isRazorpayConfigured(): boolean {
    return this.razorpay != null;
  }

  isDirectCheckoutAllowed(): boolean {
    if (!this.isRazorpayConfigured()) return true;
    const flag = this.config.get<string>('PAYMENTS_ALLOW_DIRECT_CHECKOUT');
    return flag === 'true' || flag === '1';
  }

  private pendingKey(razorpayOrderId: string): string {
    return `payments:razorpay:pending:${razorpayOrderId}`;
  }

  private verifySignature(
    orderId: string,
    paymentId: string,
    signature: string,
  ): void {
    const secret = this.config.get<string>('RAZORPAY_KEY_SECRET')?.trim();
    if (!secret) {
      throw new ServiceUnavailableException('Payments not configured');
    }
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    if (expected !== signature) {
      throw new BadRequestException('Invalid payment signature');
    }
  }

  private async attemptRefund(
    paymentId: string,
    amountPaise: number,
  ): Promise<RefundAttempt> {
    if (!this.razorpay) {
      return { status: 'REFUND_FAILED' };
    }
    try {
      const refund = await this.razorpay.payments.refund(paymentId, {
        amount: amountPaise,
        notes: { reason: 'checkout_failed_auto_refund' },
      });
      const refundId =
        typeof refund === 'object' && refund !== null && 'id' in refund
          ? String((refund as { id: string }).id)
          : undefined;
      this.logger.log(
        `Auto-refund initiated payment=${paymentId} refundId=${refundId ?? 'unknown'} amountPaise=${amountPaise}`,
      );
      return { status: 'REFUNDED', refundId };
    } catch (e) {
      this.logger.error(
        `Auto-refund failed payment=${paymentId} amountPaise=${amountPaise}`,
        e instanceof Error ? e.stack : e,
      );
      return { status: 'REFUND_FAILED' };
    }
  }

  private async recordCheckoutFailure(params: {
    userId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    amountPaise: number;
    reason: string;
    refund: RefundAttempt;
  }): Promise<void> {
    try {
      await this.prisma.paymentCheckoutFailure.create({
        data: {
          userId: params.userId,
          razorpayOrderId: params.razorpayOrderId,
          razorpayPaymentId: params.razorpayPaymentId,
          amountPaise: params.amountPaise,
          reason: params.reason,
          refundStatus: params.refund.status,
          razorpayRefundId: params.refund.refundId ?? null,
        },
      });
    } catch (e) {
      this.logger.error(
        `Failed to persist PaymentCheckoutFailure payment=${params.razorpayPaymentId}`,
        e instanceof Error ? e.stack : e,
      );
    }
  }

  async createRazorpayOrder(userId: string, dto: CreateRazorpayOrderDto) {
    if (!this.razorpay) {
      throw new ServiceUnavailableException(
        'Razorpay is not configured on the server',
      );
    }

    const prep = await this.orders.prepareCheckoutForPayment(
      userId,
      dto.addressId,
    );

    const amountPaise = Math.round(prep.total * 100);
    if (amountPaise < 100) {
      throw new BadRequestException('Minimum payable amount is ₹1');
    }

    const receipt = `vk_${userId.slice(0, 8)}_${Date.now()}`;
    const rzOrder = await this.razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt,
      notes: {
        userId,
        streamId: prep.streamId,
        addressId: dto.addressId,
      },
    });

    const pending: PendingPayment = {
      userId,
      addressId: dto.addressId,
      shippingAddress: prep.shippingAddress,
      amountPaise,
      subtotal: prep.subtotal,
      deliveryFee: prep.deliveryFee,
      deliveryProvider: prep.deliveryProvider,
      streamId: prep.streamId,
    };
    await this.redis.set(
      this.pendingKey(rzOrder.id),
      JSON.stringify(pending),
      PENDING_TTL_SECONDS,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, phone: true },
    });

    this.logger.log(
      `Razorpay order created user=${userId} rz=${rzOrder.id} address=${dto.addressId} total=${prep.total}`,
    );

    return {
      razorpayOrderId: rzOrder.id,
      amount: amountPaise,
      currency: 'INR',
      keyId: this.config.get<string>('RAZORPAY_KEY_ID'),
      subtotal: prep.subtotal,
      deliveryFee: prep.deliveryFee,
      total: prep.total,
      prefill: {
        name: user?.name ?? '',
        email: user?.email ?? '',
        contact: user?.phone ?? '',
      },
    };
  }

  async verifyAndCheckout(userId: string, dto: VerifyRazorpayPaymentDto) {
    if (!this.razorpay) {
      throw new ServiceUnavailableException(
        'Razorpay is not configured on the server',
      );
    }

    this.verifySignature(
      dto.razorpayOrderId,
      dto.razorpayPaymentId,
      dto.razorpaySignature,
    );

    const existing = await this.prisma.order.findFirst({
      where: { razorpayPaymentId: dto.razorpayPaymentId },
    });
    if (existing) {
      return this.orders.toCheckoutResponse(existing);
    }

    const priorFailure = await this.prisma.paymentCheckoutFailure.findUnique({
      where: { razorpayPaymentId: dto.razorpayPaymentId },
    });
    if (priorFailure) {
      if (priorFailure.refundStatus === 'REFUNDED') {
        throw new BadRequestException(
          'Your payment was refunded automatically because the order could not be completed. The refund should appear in 5–7 business days.',
        );
      }
      throw new BadRequestException(
        `We could not complete your order for this payment. Please contact support with payment ID: ${dto.razorpayPaymentId}`,
      );
    }

    const raw = await this.redis.get(this.pendingKey(dto.razorpayOrderId));
    if (!raw) {
      throw new BadRequestException(
        'Payment session expired or invalid. Please try checkout again.',
      );
    }

    let pending: PendingPayment;
    try {
      pending = JSON.parse(raw) as PendingPayment;
    } catch {
      throw new BadRequestException('Invalid payment session');
    }

    if (pending.userId !== userId) {
      throw new BadRequestException('Payment does not belong to this account');
    }

    if (!pending.addressId || !pending.shippingAddress) {
      throw new BadRequestException(
        'Payment session is missing address. Please checkout again.',
      );
    }

    try {
      const result = await this.orders.checkoutFromCart(
        userId,
        {
          addressId: pending.addressId,
          shippingAddress: pending.shippingAddress,
          paymentMethod: 'RAZORPAY',
        },
        {
          markPaid: true,
          razorpayOrderId: dto.razorpayOrderId,
          razorpayPaymentId: dto.razorpayPaymentId,
          deliveryFee: pending.deliveryFee,
          deliveryProvider: pending.deliveryProvider,
        },
      );

      await this.redis.del(this.pendingKey(dto.razorpayOrderId));
      this.logger.log(
        `Razorpay checkout completed user=${userId} order=${result.orderId} payment=${dto.razorpayPaymentId}`,
      );
      return result;
    } catch (err) {
      const reason =
        err instanceof BadRequestException || err instanceof ForbiddenException
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);

      this.logger.error(
        `Checkout failed after Razorpay capture user=${userId} rzOrder=${dto.razorpayOrderId} payment=${dto.razorpayPaymentId} reason=${reason}`,
        err instanceof Error ? err.stack : undefined,
      );

      const refund = await this.attemptRefund(
        dto.razorpayPaymentId,
        pending.amountPaise,
      );

      await this.recordCheckoutFailure({
        userId,
        razorpayOrderId: dto.razorpayOrderId,
        razorpayPaymentId: dto.razorpayPaymentId,
        amountPaise: pending.amountPaise,
        reason,
        refund,
      });

      if (refund.status === 'REFUNDED') {
        throw new BadRequestException(
          'Payment received but we could not place your order. A full refund has been initiated and should reflect in 5–7 business days.',
        );
      }

      throw new BadRequestException(
        `Payment received but we could not place your order. Our team will process a refund shortly — contact support with payment ID: ${dto.razorpayPaymentId}`,
      );
    }
  }
}
