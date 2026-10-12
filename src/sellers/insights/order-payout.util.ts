import { OrderStatus, Prisma, ShippingPayer } from '@prisma/client';
import {
  calculateSellerPayout,
  roundInr,
  SellerPayoutBreakdown,
} from '../../pricing/seller-payout-calculator';

/** Orders that count as sales (cancelled / returned / unpaid are excluded). */
export const REVENUE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PACKED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

const DEFAULT_PRODUCT_GST_PERCENT = 18;
const SERVICE_GST_RATE = 0.18;

export const INSIGHTS_ORDER_SELECT = {
  id: true,
  createdAt: true,
  status: true,
  totalAmount: true,
  deliveryFee: true,
  shippingPayer: true,
  couponCode: true,
  couponDiscount: true,
  invoiceNumber: true,
  razorpayPaymentId: true,
  trackingId: true,
  carrierName: true,
  packedAt: true,
  shippedAt: true,
  deliveredAt: true,
  shippingAddress: true,
  buyer: { select: { user: { select: { name: true } } } },
  items: {
    select: {
      quantity: true,
      price: true,
      variantLabel: true,
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          hsnCode: true,
          gstPercent: true,
          images: true,
          sellerId: true,
        },
      },
    },
  },
} satisfies Prisma.OrderSelect;

export type InsightsOrderRow = Prisma.OrderGetPayload<{
  select: typeof INSIGHTS_ORDER_SELECT;
}>;

export interface PayoutContext {
  sellerId: string;
  gstRegistered: boolean;
  commissionWaiverActive: boolean;
  logisticsBaseInr: number;
}

export interface OrderPayoutLine {
  productId: string;
  name: string;
  variantLabel: string | null;
  sku: string | null;
  hsnCode: string | null;
  imageUrl: string | null;
  gstRatePercent: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  taxableValue: number;
  gstAmount: number;
}

export interface OrderPayout {
  order: InsightsOrderRow;
  lines: OrderPayoutLine[];
  units: number;
  itemSales: number;
  taxableValue: number;
  productGst: number;
  buyerDeliveryFee: number;
  couponDiscount: number;
  totalPaid: number;
  sellerPaysShipping: boolean;
  logisticsSource: 'ACTUAL' | 'ESTIMATED' | 'BUYER_PAID';
  gatewayFee: number;
  gatewayGst: number;
  logisticsFee: number;
  logisticsGst: number;
  commission: number;
  commissionGst: number;
  tds: number;
  tcs: number;
  totalDeductions: number;
  netPayout: number;
  breakdown: SellerPayoutBreakdown;
}

function lineAmount(breakdown: SellerPayoutBreakdown, key: string): number {
  const all = [...breakdown.deductions, ...breakdown.taxes, ...breakdown.info];
  return Math.abs(all.find((l) => l.key === key)?.amount ?? 0);
}

/**
 * Seller payout for one order, using the shared payout calculator.
 * Customer price = this seller's item subtotal (coupons are Vybekart-funded and buyer-paid
 * shipping is passed through, so neither changes the seller settlement).
 * Logistics: seller-paid → actual Delhivery fee on the order (treated as GST-inclusive), or the
 * standard estimate when no fee was recorded; buyer-paid → nothing deducted.
 */
export function computeOrderPayout(
  order: InsightsOrderRow,
  ctx: PayoutContext,
): OrderPayout {
  const sellerItems = order.items.filter((i) => i.product.sellerId === ctx.sellerId);

  let rawTaxable = 0;
  const lines: OrderPayoutLine[] = sellerItems.map((item) => {
    const lineTotal = item.price * item.quantity;
    const ratePercent = ctx.gstRegistered
      ? item.product.gstPercent ?? DEFAULT_PRODUCT_GST_PERCENT
      : 0;
    const taxable = ctx.gstRegistered ? lineTotal / (1 + ratePercent / 100) : lineTotal;
    rawTaxable += taxable;
    return {
      productId: item.product.id,
      name: item.product.name,
      variantLabel: item.variantLabel,
      sku: item.product.sku,
      hsnCode: item.product.hsnCode,
      imageUrl: item.product.images?.[0] ?? null,
      gstRatePercent: ratePercent,
      quantity: item.quantity,
      unitPrice: roundInr(item.price),
      lineTotal: roundInr(lineTotal),
      taxableValue: roundInr(taxable),
      gstAmount: roundInr(lineTotal - taxable),
    };
  });

  const itemSales = roundInr(sellerItems.reduce((s, i) => s + i.price * i.quantity, 0));
  const units = sellerItems.reduce((s, i) => s + i.quantity, 0);
  const effectiveGstRate =
    ctx.gstRegistered && rawTaxable > 0 ? itemSales / rawTaxable - 1 : DEFAULT_PRODUCT_GST_PERCENT / 100;

  const sellerPaysShipping = order.shippingPayer === ShippingPayer.SELLER_PAYS;
  const actualFee = Math.max(0, order.deliveryFee ?? 0);
  let logisticsBaseInr: number;
  let logisticsLabel: string;
  let logisticsNote: string;
  let logisticsSource: OrderPayout['logisticsSource'];
  if (!sellerPaysShipping) {
    logisticsBaseInr = 0;
    logisticsLabel = 'Logistics';
    logisticsNote = 'Shipping paid by the buyer — nothing deducted';
    logisticsSource = 'BUYER_PAID';
  } else if (actualFee > 0) {
    logisticsBaseInr = actualFee / (1 + SERVICE_GST_RATE);
    logisticsLabel = 'Logistics (Delhivery)';
    logisticsNote = `Delhivery fee ₹${roundInr(actualFee)} incl. 18% GST`;
    logisticsSource = 'ACTUAL';
  } else {
    logisticsBaseInr = ctx.logisticsBaseInr;
    logisticsLabel = 'Logistics (estimated)';
    logisticsNote = `₹${ctx.logisticsBaseInr} base + 18% GST`;
    logisticsSource = 'ESTIMATED';
  }

  const breakdown = calculateSellerPayout(itemSales, ctx.commissionWaiverActive, {
    gstRegistered: ctx.gstRegistered,
    productGstRate: effectiveGstRate,
    logisticsBaseInr,
    logisticsLabel,
    logisticsNote,
  });

  const gatewayFee = lineAmount(breakdown, 'gateway');
  const logisticsFee = lineAmount(breakdown, 'logistics');
  const commission = lineAmount(breakdown, 'commission');
  const tds = lineAmount(breakdown, 'tds');
  const tcs = lineAmount(breakdown, 'tcs');
  const totalDeductions = roundInr(gatewayFee + logisticsFee + commission + tds + tcs);
  // Net from rounded lines so every report column adds up exactly.
  const netPayout = roundInr(itemSales - totalDeductions);
  const taxableValue = roundInr(lines.reduce((s, l) => s + l.taxableValue, 0));

  return {
    order,
    lines,
    units,
    itemSales,
    taxableValue,
    productGst: roundInr(itemSales - taxableValue),
    buyerDeliveryFee: sellerPaysShipping ? 0 : roundInr(actualFee),
    couponDiscount: roundInr(order.couponDiscount ?? 0),
    totalPaid: roundInr(order.totalAmount),
    sellerPaysShipping,
    logisticsSource,
    gatewayFee,
    gatewayGst: lineAmount(breakdown, 'gst_gateway'),
    logisticsFee,
    logisticsGst: lineAmount(breakdown, 'gst_logistics'),
    commission,
    commissionGst: lineAmount(breakdown, 'gst_commission'),
    tds,
    tcs,
    totalDeductions,
    netPayout,
    breakdown: { ...breakdown, netSettlement: netPayout },
  };
}

export interface PayoutTotals {
  orders: number;
  units: number;
  itemSales: number;
  taxableValue: number;
  productGst: number;
  buyerDeliveryFees: number;
  couponDiscounts: number;
  totalCollected: number;
  gatewayFee: number;
  gatewayGst: number;
  logisticsFee: number;
  logisticsGst: number;
  commission: number;
  commissionGst: number;
  tds: number;
  tcs: number;
  totalDeductions: number;
  netPayout: number;
  inputGstCredits: number;
}

export function sumPayouts(rows: OrderPayout[]): PayoutTotals {
  const sum = (pick: (r: OrderPayout) => number) =>
    roundInr(rows.reduce((s, r) => s + pick(r), 0));
  const gatewayGst = sum((r) => r.gatewayGst);
  const logisticsGst = sum((r) => r.logisticsGst);
  const commissionGst = sum((r) => r.commissionGst);
  const tcs = sum((r) => r.tcs);
  return {
    orders: rows.length,
    units: rows.reduce((s, r) => s + r.units, 0),
    itemSales: sum((r) => r.itemSales),
    taxableValue: sum((r) => r.taxableValue),
    productGst: sum((r) => r.productGst),
    buyerDeliveryFees: sum((r) => r.buyerDeliveryFee),
    couponDiscounts: sum((r) => r.couponDiscount),
    totalCollected: sum((r) => r.totalPaid),
    gatewayFee: sum((r) => r.gatewayFee),
    gatewayGst,
    logisticsFee: sum((r) => r.logisticsFee),
    logisticsGst,
    commission: sum((r) => r.commission),
    commissionGst,
    tds: sum((r) => r.tds),
    tcs,
    totalDeductions: sum((r) => r.totalDeductions),
    netPayout: sum((r) => r.netPayout),
    inputGstCredits: roundInr(gatewayGst + logisticsGst + commissionGst + tcs),
  };
}

export function orderShortId(orderId: string): string {
  return orderId.slice(-4).toUpperCase();
}
