import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrderStatus,
  Prisma,
  ReplacementStatus,
  ShippingPayer,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isSellerGstRegistered, roundInr } from '../../pricing/seller-payout-calculator';
import {
  bucketIndexFor,
  buildInsightsBuckets,
  InsightsRange,
  percentChange,
  resolveInsightsRange,
} from '../../sellers/insights/insights-range.util';
import {
  computeOrderPayout,
  INSIGHTS_ORDER_SELECT,
  OrderPayout,
  PayoutContext,
  PayoutTotals,
  REVENUE_ORDER_STATUSES,
  sumPayouts,
} from '../../sellers/insights/order-payout.util';
import { logisticsBaseInr } from '../../sellers/insights/seller-insights.service';
import { AdminInsightsQueryDto, AdminReportStatus } from '../dto/admin-insights-query.dto';

export const ADMIN_ORDER_SELECT = {
  ...INSIGHTS_ORDER_SELECT,
  totalAmount: true,
  deliveryFee: true,
  shippingPayer: true,
  streamId: true,
  buyer: { select: { id: true, user: { select: { name: true, email: true, phone: true } } } },
} satisfies Prisma.OrderSelect;

export type AdminOrderRow = Prisma.OrderGetPayload<{ select: typeof ADMIN_ORDER_SELECT }>;

export const ADMIN_SELLER_SELECT = {
  id: true,
  businessName: true,
  logoUrl: true,
  gstNumber: true,
  businessAddress: true,
  commissionWaiverActive: true,
  status: true,
  createdAt: true,
  bankAccount: true,
  bankName: true,
  accountHolderName: true,
  accountType: true,
  ifscCode: true,
  user: { select: { name: true, email: true, phone: true } },
} satisfies Prisma.SellerSelect;

export type AdminSellerRow = Prisma.SellerGetPayload<{ select: typeof ADMIN_SELLER_SELECT }>;

/** One seller's share of an order (multi-seller carts produce one part per seller). */
export interface AdminSellerPart {
  seller: AdminSellerRow;
  payout: OrderPayout;
}

export interface AdminOrderPayout {
  order: AdminOrderRow;
  parts: AdminSellerPart[];
  units: number;
  itemSales: number;
  couponDiscount: number;
  /** Delivery charge the buyer paid (buyer-pays orders only). */
  buyerDeliveryFee: number;
  /** Actual Delhivery charge quoted at checkout (stored for every order). */
  delhiveryFee: number;
  totalPaid: number;
  gatewayFee: number;
  logisticsFee: number;
  commission: number;
  commissionGst: number;
  tds: number;
  tcs: number;
  totalDeductions: number;
  sellerPayout: number;
}

export interface PlatformTotals {
  orders: number;
  units: number;
  buyers: number;
  activeSellers: number;
  gmv: number;
  taxableValue: number;
  productGst: number;
  couponDiscounts: number;
  buyerDeliveryFees: number;
  totalCollected: number;
  gatewayFee: number;
  logisticsFee: number;
  commission: number;
  commissionGst: number;
  tds: number;
  tcs: number;
  sellerDeductions: number;
  sellerPayouts: number;
  delhiveryCost: number;
  /** Logistics charged to sellers + buyer delivery charges − actual Delhivery charges. */
  logisticsNet: number;
  /** Commission net of GST + logistics net − Vybekart-funded coupons (before Razorpay / ops costs). */
  platformContribution: number;
}

export interface AdminSellerSummary {
  seller: AdminSellerRow;
  rows: OrderPayout[];
  totals: PayoutTotals;
}

export interface AdminDataset {
  range: InsightsRange;
  scope: { seller: AdminSellerRow | null; status: AdminReportStatus | null };
  logisticsBaseInr: number;
  rows: AdminOrderPayout[];
  totals: PlatformTotals;
  previousTotals: PlatformTotals;
  /** Sellers with sales in the window, highest GMV first. */
  sellers: AdminSellerSummary[];
  /** Orders created in the window by status (incl. cancelled / returned, excl. unpaid). */
  statusCounts: Record<string, number>;
}

const STATUS_BREAKDOWN: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PACKED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.RETURNED,
];

export function sumPlatform(rows: AdminOrderPayout[]): PlatformTotals {
  const sum = (pick: (r: AdminOrderPayout) => number) =>
    roundInr(rows.reduce((s, r) => s + pick(r), 0));
  const buyers = new Set(rows.map((r) => r.order.buyer?.id).filter(Boolean));
  const sellers = new Set(rows.flatMap((r) => r.parts.map((p) => p.seller.id)));
  const logisticsFee = sum((r) => r.logisticsFee);
  const buyerDeliveryFees = sum((r) => r.buyerDeliveryFee);
  const delhiveryCost = sum((r) => r.delhiveryFee);
  const commission = sum((r) => r.commission);
  const commissionGst = sum((r) => r.commissionGst);
  const couponDiscounts = sum((r) => r.couponDiscount);
  const logisticsNet = roundInr(logisticsFee + buyerDeliveryFees - delhiveryCost);
  return {
    orders: rows.length,
    units: rows.reduce((s, r) => s + r.units, 0),
    buyers: buyers.size,
    activeSellers: sellers.size,
    gmv: sum((r) => r.itemSales),
    taxableValue: sum((r) => r.parts.reduce((s, p) => s + p.payout.taxableValue, 0)),
    productGst: sum((r) => r.parts.reduce((s, p) => s + p.payout.productGst, 0)),
    couponDiscounts,
    buyerDeliveryFees,
    totalCollected: sum((r) => r.totalPaid),
    gatewayFee: sum((r) => r.gatewayFee),
    logisticsFee,
    commission,
    commissionGst,
    tds: sum((r) => r.tds),
    tcs: sum((r) => r.tcs),
    sellerDeductions: sum((r) => r.totalDeductions),
    sellerPayouts: sum((r) => r.sellerPayout),
    delhiveryCost,
    logisticsNet,
    platformContribution: roundInr(commission - commissionGst + logisticsNet - couponDiscounts),
  };
}

/** Builds the per-order admin view from each seller's payout (same calculator sellers see). */
export function computeAdminOrder(
  order: AdminOrderRow,
  sellers: Map<string, { seller: AdminSellerRow; ctx: PayoutContext }>,
  onlySellerId?: string,
): AdminOrderPayout | null {
  const sellerIds = [...new Set(order.items.map((i) => i.product.sellerId))].filter(
    (id) => !onlySellerId || id === onlySellerId,
  );
  const parts: AdminSellerPart[] = [];
  for (const id of sellerIds) {
    const entry = sellers.get(id);
    if (!entry) continue;
    parts.push({ seller: entry.seller, payout: computeOrderPayout(order, entry.ctx) });
  }
  if (parts.length === 0) return null;
  const add = (pick: (p: OrderPayout) => number) =>
    roundInr(parts.reduce((s, p) => s + pick(p.payout), 0));
  const deliveryFee = Math.max(0, order.deliveryFee ?? 0);
  return {
    order,
    parts,
    units: parts.reduce((s, p) => s + p.payout.units, 0),
    itemSales: add((p) => p.itemSales),
    couponDiscount: roundInr(order.couponDiscount ?? 0),
    buyerDeliveryFee: order.shippingPayer === ShippingPayer.BUYER_PAYS ? roundInr(deliveryFee) : 0,
    delhiveryFee: roundInr(deliveryFee),
    totalPaid: roundInr(order.totalAmount ?? 0),
    gatewayFee: add((p) => p.gatewayFee),
    logisticsFee: add((p) => p.logisticsFee),
    commission: add((p) => p.commission),
    commissionGst: add((p) => p.commissionGst),
    tds: add((p) => p.tds),
    tcs: add((p) => p.tcs),
    totalDeductions: add((p) => p.totalDeductions),
    sellerPayout: add((p) => p.netPayout),
  };
}

@Injectable()
export class AdminInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async collect(
    query: AdminInsightsQueryDto,
    options: { status?: AdminReportStatus } = {},
  ): Promise<AdminDataset> {
    const range = resolveInsightsRange(query.period, query.from, query.to);
    const baseInr = logisticsBaseInr(this.config);

    let scopeSeller: AdminSellerRow | null = null;
    if (query.sellerId) {
      scopeSeller = await this.prisma.seller.findUnique({
        where: { id: query.sellerId },
        select: ADMIN_SELLER_SELECT,
      });
      if (!scopeSeller) throw new NotFoundException('Seller partner not found');
    }

    const statuses = options.status ? [options.status as OrderStatus] : REVENUE_ORDER_STATUSES;
    const sellerFilter: Prisma.OrderWhereInput = query.sellerId
      ? { items: { some: { product: { sellerId: query.sellerId } } } }
      : {};
    const fetchWindow = (gte: Date, lt: Date) =>
      this.prisma.order.findMany({
        where: { ...sellerFilter, status: { in: statuses }, createdAt: { gte, lt } },
        select: ADMIN_ORDER_SELECT,
        orderBy: { createdAt: 'desc' },
      });

    const [current, previous, statusGroups] = await Promise.all([
      fetchWindow(range.gte, range.lt),
      fetchWindow(range.previous.gte, range.previous.lt),
      this.prisma.order.groupBy({
        by: ['status'],
        where: {
          ...sellerFilter,
          status: { in: STATUS_BREAKDOWN },
          createdAt: { gte: range.gte, lt: range.lt },
        },
        _count: { _all: true },
      }),
    ]);

    const sellerIds = new Set<string>();
    for (const o of [...current, ...previous]) {
      for (const i of o.items) {
        if (!query.sellerId || i.product.sellerId === query.sellerId) sellerIds.add(i.product.sellerId);
      }
    }
    const sellerRows = sellerIds.size
      ? await this.prisma.seller.findMany({
          where: { id: { in: [...sellerIds] } },
          select: ADMIN_SELLER_SELECT,
        })
      : [];
    const sellers = new Map(
      sellerRows.map((s) => [
        s.id,
        {
          seller: s,
          ctx: {
            sellerId: s.id,
            gstRegistered: isSellerGstRegistered(s.gstNumber),
            commissionWaiverActive: s.commissionWaiverActive,
            logisticsBaseInr: baseInr,
          } satisfies PayoutContext,
        },
      ]),
    );

    const toRows = (orders: AdminOrderRow[]) =>
      orders
        .map((o) => computeAdminOrder(o, sellers, query.sellerId))
        .filter((r): r is AdminOrderPayout => r != null);
    const rows = toRows(current);
    const previousRows = toRows(previous);

    const bySeller = new Map<string, AdminSellerSummary>();
    for (const r of rows) {
      for (const p of r.parts) {
        const entry = bySeller.get(p.seller.id) ?? { seller: p.seller, rows: [], totals: sumPayouts([]) };
        entry.rows.push(p.payout);
        bySeller.set(p.seller.id, entry);
      }
    }
    const sellerSummaries = [...bySeller.values()]
      .map((s) => ({ ...s, totals: sumPayouts(s.rows) }))
      .sort((a, b) => b.totals.itemSales - a.totals.itemSales);

    const statusCounts: Record<string, number> = Object.fromEntries(STATUS_BREAKDOWN.map((s) => [s, 0]));
    for (const g of statusGroups) statusCounts[g.status] = g._count._all;

    return {
      range,
      scope: { seller: scopeSeller, status: options.status ?? null },
      logisticsBaseInr: baseInr,
      rows,
      totals: sumPlatform(rows),
      previousTotals: sumPlatform(previousRows),
      sellers: sellerSummaries,
      statusCounts,
    };
  }

  async getDashboard(query: AdminInsightsQueryDto) {
    const data = await this.collect(query);
    const { range, rows, totals: t, previousTotals: p } = data;

    const buckets = buildInsightsBuckets(range);
    const series = buckets.map((b) => ({ label: b.label, revenue: 0, orders: 0, commission: 0 }));
    for (const r of rows) {
      const idx = bucketIndexFor(buckets, r.order.createdAt.getTime());
      if (idx < 0) continue;
      series[idx].revenue += r.itemSales;
      series[idx].orders += 1;
      series[idx].commission += r.commission;
    }
    for (const s of series) {
      s.revenue = roundInr(s.revenue);
      s.commission = roundInr(s.commission);
    }

    const window = { gte: range.gte, lt: range.lt };
    const [
      sellersVerified,
      sellersPending,
      sellersNeedChanges,
      newSellers,
      buyersTotal,
      newBuyers,
      pendingReplacements,
      awaitingPacking,
    ] = await Promise.all([
      this.prisma.seller.count({ where: { status: VerificationStatus.VERIFIED } }),
      this.prisma.seller.count({ where: { status: VerificationStatus.PENDING } }),
      this.prisma.seller.count({ where: { status: VerificationStatus.NEEDS_CHANGES } }),
      this.prisma.seller.count({ where: { createdAt: window } }),
      this.prisma.buyer.count(),
      this.prisma.buyer.count({ where: { createdAt: window } }),
      this.prisma.replacementRequest.count({
        where: {
          status: { in: [ReplacementStatus.REQUESTED, ReplacementStatus.PENDING_ADMIN_REVIEW] },
        },
      }),
      this.prisma.order.count({ where: { status: OrderStatus.PAID } }),
    ]);

    return {
      period: range.period,
      from: range.from,
      to: range.to,
      label: range.label,
      granularity: range.granularity,
      previous: { from: range.previous.from, to: range.previous.to, label: range.previous.label },
      seller: data.scope.seller
        ? { id: data.scope.seller.id, businessName: data.scope.seller.businessName }
        : null,
      summary: {
        gmv: t.gmv,
        orders: t.orders,
        units: t.units,
        avgOrderValue: t.orders > 0 ? roundInr(t.gmv / t.orders) : 0,
        buyers: t.buyers,
        activeSellers: t.activeSellers,
        totalCollected: t.totalCollected,
        buyerDeliveryFees: t.buyerDeliveryFees,
        couponDiscounts: t.couponDiscounts,
        sellerPayouts: t.sellerPayouts,
        sellerDeductions: t.sellerDeductions,
        commission: t.commission,
        gatewayFee: t.gatewayFee,
        logisticsFee: t.logisticsFee,
        tds: t.tds,
        tcs: t.tcs,
        delhiveryCost: t.delhiveryCost,
        logisticsNet: t.logisticsNet,
        platformContribution: t.platformContribution,
        previousGmv: p.gmv,
        previousOrders: p.orders,
        previousCommission: p.commission,
        gmvChangePercent: percentChange(t.gmv, p.gmv),
        ordersChangePercent: percentChange(t.orders, p.orders),
        commissionChangePercent: percentChange(t.commission, p.commission),
      },
      series,
      statusCounts: data.statusCounts,
      topSellers: data.sellers.slice(0, 5).map((s) => ({
        sellerId: s.seller.id,
        businessName: s.seller.businessName,
        logoUrl: s.seller.logoUrl,
        orders: s.totals.orders,
        gmv: s.totals.itemSales,
        payout: s.totals.netPayout,
        commission: s.totals.commission,
      })),
      platform: {
        sellersVerified,
        sellersPending,
        sellersNeedChanges,
        newSellers,
        buyersTotal,
        newBuyers,
        pendingReplacements,
        awaitingPacking,
      },
    };
  }
}
