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
import { parseShippingAddressSnapshot } from './templates/shipping-address.util';
import { DelhiveryShippingCostResult } from '../delhivery/delhivery.types';

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
      await this.sendRecordsCopy(orderId, 'buyer', buyerEmail, buyerMail);
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
      await this.sendRecordsCopy(orderId, 'seller', sellerEmail, sellerMail);
    }
  }

  /** Copy of a sent order email to the internal records inbox (never throws). */
  private async sendRecordsCopy(
    orderId: string,
    audience: 'buyer' | 'seller',
    originalTo: string,
    mail: { subject: string; html: string; text: string },
  ): Promise<void> {
    const recordsTo = this.mail.recordsEmail();
    if (recordsTo.toLowerCase() === originalTo.toLowerCase()) return;
    try {
      const note = `Copy of the ${audience} email sent to ${originalTo}`;
      await this.mail.sendTransactional(recordsTo, {
        subject: `[Copy: ${audience}] ${mail.subject}`,
        html: `<p style="font-family:Arial,sans-serif;font-size:12px;color:#64748b;">${note}</p>${mail.html}`,
        text: `${note}\n\n${mail.text}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Records copy of ${audience} order email failed order=${orderId}: ${msg}`,
      );
    }
  }

  /**
   * Internal record of the Delhivery charge for a pickup request. Sellers never
   * see this amount. Never throws to caller.
   */
  async sendDelhiveryChargeRecord(input: {
    kind: 'ORDER' | 'REPLACEMENT';
    referenceId: string;
    orderId: string;
    sellerName: string;
    waybill: string;
    originPin: string;
    destinationPin: string;
    weightGrams: number;
    quote: DelhiveryShippingCostResult | null;
  }): Promise<void> {
    try {
      const raw = input.quote?.raw as Record<string, unknown> | null | undefined;
      const quoteFailed = !input.quote || (raw != null && 'error' in raw);
      const fee = quoteFailed ? null : input.quote!.fee;
      const amount =
        fee != null ? `₹${fee.toFixed(2)}` : 'Not available (Delhivery quote failed)';
      const shortId = input.orderId.slice(-8).toUpperCase();
      const label = input.kind === 'REPLACEMENT' ? 'Replacement' : 'Order';
      const placedAt = new Date().toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      });
      const rows: Array<[string, string]> = [
        ['Type', label],
        ['Order ID', input.orderId],
        ...(input.kind === 'REPLACEMENT'
          ? ([['Replacement ID', input.referenceId]] as Array<[string, string]>)
          : []),
        ['Seller partner', input.sellerName],
        ['Waybill (AWB)', input.waybill],
        ['Pickup pincode', input.originPin],
        ['Delivery pincode', input.destinationPin],
        ['Billed weight (est.)', `${input.weightGrams} g`],
        ['Delhivery charge to be deducted', amount],
        ['Pickup requested at', placedAt],
      ];
      const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = `<p>A Delhivery pickup was requested. The following amount will be deducted from the Delhivery wallet for this shipment:</p>
<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
${rows.map(([k, v]) => `<tr><td><strong>${esc(k)}</strong></td><td>${esc(v)}</td></tr>`).join('\n')}
</table>
<p style="color:#64748b;font-size:12px;">Live quote from Delhivery's rate API at pickup time. This amount is not shown to the seller partner.</p>`;
      const text = [
        'A Delhivery pickup was requested. The following amount will be deducted from the Delhivery wallet:',
        '',
        ...rows.map(([k, v]) => `${k}: ${v}`),
      ].join('\n');

      await this.mail.sendTransactional(this.mail.recordsEmail(), {
        subject: `Delhivery charge ${fee != null ? `₹${fee.toFixed(2)}` : '(unavailable)'} — ${label} #${shortId}`,
        html,
        text,
      });
      this.logger.log(
        `Delhivery charge record sent ${label.toLowerCase()}=${input.referenceId} fee=${fee ?? 'n/a'}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `Delhivery charge record email failed for ${input.referenceId}: ${msg}`,
      );
    }
  }

  private buildPayload(order: {
    id: string;
    status: string;
    createdAt: Date;
    shippingAddress: string | null;
    totalAmount: number;
    deliveryFee: number;
    shippingPayer?: string | null;
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
    const actualDeliveryFee = order.deliveryFee ?? 0;
    const buyerDeliveryFee =
      order.shippingPayer === 'BUYER_PAYS' ? actualDeliveryFee : 0;
    const shippingSnapshot = order.shippingAddress?.trim() || '—';
    const shippingParts = parseShippingAddressSnapshot(shippingSnapshot);

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
      shippingAddress: shippingSnapshot,
      shippingContactName: shippingParts.shippingContactName,
      shippingPhone: shippingParts.shippingPhone,
      shippingAddressLine: shippingParts.shippingAddressLine,
      streamTitle: order.stream?.title ?? null,
      subtotal: itemsSubtotal,
      /** Buyer-facing shipping (Free when seller pays). */
      deliveryFee: buyerDeliveryFee,
      /** Actual Delhivery fee for seller-facing emails. */
      actualDeliveryFee,
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
