import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';
import { resolvePublicBaseUrl } from '../common/utils/public-base-url';
import { getVybeKartMailBranding } from './templates/vybekart-email-layout';
import {
  buildBuyerOrderConfirmationEmail,
  buildSellerNewOrderEmail,
  OrderEmailPayload,
} from './templates/order-email.template';

@Injectable()
export class OrderNotificationService {
  private readonly logger = new Logger(OrderNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /** Fire-and-forget order emails to buyer and seller (never throws to caller). */
  async sendOrderPlacedEmails(orderId: string): Promise<void> {
    try {
      await this.sendOrderPlacedEmailsInternal(orderId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Order email failed for ${orderId}: ${msg}`);
    }
  }

  private async sendOrderPlacedEmailsInternal(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              include: {
                seller: {
                  include: {
                    user: { select: { id: true, name: true, email: true } },
                  },
                },
              },
            },
          },
        },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        stream: { select: { id: true, title: true } },
      },
    });

    if (!order) {
      this.logger.warn(`Order email skipped: order ${orderId} not found`);
      return;
    }

    const buyerEmail = order.buyer?.user?.email?.trim();
    const firstItem = order.items[0];
    const sellerUser = firstItem?.product?.seller?.user;
    const sellerEmail = sellerUser?.email?.trim();

    if (!buyerEmail && !sellerEmail) {
      this.logger.warn(`Order email skipped: no emails for order ${orderId}`);
      return;
    }

    const payload = this.buildPayload(order);
    const branding = getVybeKartMailBranding(this.config);

    if (buyerEmail) {
      const buyerMail = buildBuyerOrderConfirmationEmail(
        branding,
        buyerEmail,
        payload,
      );
      await this.mail.sendTransactional(buyerEmail, {
        subject: buyerMail.subject,
        html: buyerMail.html,
        text: buyerMail.text,
      });
      this.logger.log(`Buyer order email sent order=${orderId} to=${buyerEmail}`);
    }

    if (sellerEmail) {
      const sellerMail = buildSellerNewOrderEmail(
        branding,
        sellerEmail,
        payload,
      );
      await this.mail.sendTransactional(sellerEmail, {
        subject: sellerMail.subject,
        html: sellerMail.html,
        text: sellerMail.text,
      });
      this.logger.log(`Seller order email sent order=${orderId} to=${sellerEmail}`);
    }
  }

  private buildPayload(order: {
    id: string;
    status: string;
    createdAt: Date;
    shippingAddress: string | null;
    totalAmount: number;
    deliveryFee: number;
    deliveryProvider: string | null;
    razorpayPaymentId: string | null;
    items: Array<{
      quantity: number;
      price: number;
      variantLabel: string | null;
      product: {
        name: string;
        images: string[];
        seller: { businessName: string | null } | null;
      };
    }>;
    buyer: { user: { name: string | null } } | null;
    stream: { title: string | null } | null;
  }): OrderEmailPayload {
    const itemsSubtotal = order.items.reduce(
      (sum, i) => sum + i.price * i.quantity,
      0,
    );
    const deliveryFee = order.deliveryFee ?? 0;

    return {
      orderId: order.id,
      orderShortId: order.id.slice(-8).toUpperCase(),
      status: order.status,
      placedAt: order.createdAt.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      }),
      paymentMethod: order.razorpayPaymentId ? 'Razorpay' : 'Online',
      paymentReference: order.razorpayPaymentId,
      shippingAddress: order.shippingAddress?.trim() || '—',
      streamTitle: order.stream?.title ?? null,
      subtotal: itemsSubtotal,
      deliveryFee,
      totalAmount: order.totalAmount,
      deliveryProvider: order.deliveryProvider,
      buyerName: order.buyer?.user?.name?.trim() || 'Customer',
      sellerBusinessName:
        order.items[0]?.product?.seller?.businessName?.trim() ||
        'Seller Partner',
      items: order.items.map((item) => ({
        productName: item.product.name,
        variantLabel: item.variantLabel,
        quantity: item.quantity,
        unitPrice: item.price,
        lineTotal: item.price * item.quantity,
        imageUrl: this.resolveProductImageUrl(item.product.images?.[0]),
      })),
    };
  }

  private resolveProductImageUrl(raw: string | null | undefined): string {
    const s = (raw ?? '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;

    const base = resolvePublicBaseUrl(this.config);
    const supabase = this.config.get<string>('SUPABASE_URL')?.replace(/\/$/, '');
    const bucket =
      this.config.get<string>('SUPABASE_PUBLIC_BUCKET')?.trim() || 'Vybekart';

    if (s.startsWith('/uploads/') || s.startsWith('uploads/')) {
      const path = s.startsWith('/') ? s : `/${s}`;
      return `${base}${path}`;
    }
    if (s.startsWith('/')) {
      return `${base}${s}`;
    }
    if (supabase) {
      return `${supabase}/storage/v1/object/public/${encodeURIComponent(bucket)}/${s.replace(/^\//, '')}`;
    }
    return `${base}/uploads/${s.replace(/^\//, '')}`;
  }
}
