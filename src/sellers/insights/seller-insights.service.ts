import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { isSellerGstRegistered } from '../../pricing/seller-payout-calculator';
import { SellerInsightsQueryDto } from '../dto/seller-insights-query.dto';
import {
  buildInsightsBuckets,
  bucketIndexFor,
  InsightsRange,
  percentChange,
  resolveInsightsRange,
} from './insights-range.util';
import {
  computeOrderPayout,
  INSIGHTS_ORDER_SELECT,
  OrderPayout,
  orderShortId,
  PayoutContext,
  PayoutTotals,
  REVENUE_ORDER_STATUSES,
  sumPayouts,
} from './order-payout.util';

export function logisticsBaseInr(config: ConfigService): number {
  const value = Number(config.get('LOGISTICS_BASE_INR') ?? 75);
  return Number.isFinite(value) && value >= 0 ? value : 75;
}

export interface InsightsSellerInfo {
  id: string;
  businessName: string;
  gstNumber: string | null;
  businessAddress: string | null;
  commissionWaiverActive: boolean;
  ownerName: string | null;
  email: string | null;
  phone: string | null;
}

export interface InsightsDataset {
  seller: InsightsSellerInfo;
  range: InsightsRange;
  ctx: PayoutContext;
  rows: OrderPayout[];
  totals: PayoutTotals;
  previousTotals: PayoutTotals;
}

@Injectable()
export class SellerInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Loads every revenue order in the window (and the comparison window) with per-order payout. */
  async collect(userId: string, query: SellerInsightsQueryDto): Promise<InsightsDataset> {
    return this.collectWhere({ userId }, query);
  }

  /** Same dataset for a seller id (admin reports). */
  async collectForSeller(sellerId: string, query: SellerInsightsQueryDto): Promise<InsightsDataset> {
    return this.collectWhere({ id: sellerId }, query);
  }

  private async collectWhere(
    where: { userId: string } | { id: string },
    query: SellerInsightsQueryDto,
  ): Promise<InsightsDataset> {
    const seller = await this.prisma.seller.findUnique({
      where,
      select: {
        id: true,
        businessName: true,
        gstNumber: true,
        businessAddress: true,
        commissionWaiverActive: true,
        user: { select: { name: true, email: true, phone: true } },
      },
    });
    if (!seller) throw new NotFoundException('Seller profile not found');

    const range = resolveInsightsRange(query.period, query.from, query.to);
    const ctx: PayoutContext = {
      sellerId: seller.id,
      gstRegistered: isSellerGstRegistered(seller.gstNumber),
      commissionWaiverActive: seller.commissionWaiverActive,
      logisticsBaseInr: logisticsBaseInr(this.config),
    };

    const fetchWindow = (gte: Date, lt: Date) =>
      this.prisma.order.findMany({
        where: {
          items: { some: { product: { sellerId: seller.id } } },
          status: { in: REVENUE_ORDER_STATUSES },
          createdAt: { gte, lt },
        },
        select: INSIGHTS_ORDER_SELECT,
        orderBy: { createdAt: 'desc' },
      });

    const [current, previous] = await Promise.all([
      fetchWindow(range.gte, range.lt),
      fetchWindow(range.previous.gte, range.previous.lt),
    ]);

    const rows = current.map((o) => computeOrderPayout(o, ctx));
    const previousRows = previous.map((o) => computeOrderPayout(o, ctx));

    return {
      seller: {
        id: seller.id,
        businessName: seller.businessName,
        gstNumber: seller.gstNumber?.trim() || null,
        businessAddress: seller.businessAddress,
        commissionWaiverActive: seller.commissionWaiverActive,
        ownerName: seller.user?.name ?? null,
        email: seller.user?.email ?? null,
        phone: seller.user?.phone ?? null,
      },
      range,
      ctx,
      rows,
      totals: sumPayouts(rows),
      previousTotals: sumPayouts(previousRows),
    };
  }

  async getInsights(
    userId: string,
    query: SellerInsightsQueryDto,
    options: { includeOrders: boolean },
  ) {
    const data = await this.collect(userId, query);
    const { range, rows, totals, previousTotals } = data;

    const buckets = buildInsightsBuckets(range);
    const series = buckets.map((b) => ({ label: b.label, revenue: 0, orders: 0, payout: 0 }));
    for (const r of rows) {
      const idx = bucketIndexFor(buckets, r.order.createdAt.getTime());
      if (idx < 0) continue;
      series[idx].revenue += r.itemSales;
      series[idx].orders += 1;
      series[idx].payout += r.netPayout;
    }
    for (const s of series) {
      s.revenue = Math.round(s.revenue * 100) / 100;
      s.payout = Math.round(s.payout * 100) / 100;
    }

    const avgOrderValue =
      totals.orders > 0 ? Math.round((totals.itemSales / totals.orders) * 100) / 100 : 0;

    return {
      period: range.period,
      from: range.from,
      to: range.to,
      label: range.label,
      granularity: range.granularity,
      previous: {
        from: range.previous.from,
        to: range.previous.to,
        label: range.previous.label,
      },
      gstRegistered: data.ctx.gstRegistered,
      commissionWaiverActive: data.ctx.commissionWaiverActive,
      summary: {
        revenue: totals.itemSales,
        orders: totals.orders,
        units: totals.units,
        avgOrderValue,
        estimatedPayout: totals.netPayout,
        totalDeductions: totals.totalDeductions,
        previousRevenue: previousTotals.itemSales,
        previousOrders: previousTotals.orders,
        previousPayout: previousTotals.netPayout,
        revenueChangePercent: percentChange(totals.itemSales, previousTotals.itemSales),
        ordersChangePercent: percentChange(totals.orders, previousTotals.orders),
        payoutChangePercent: percentChange(totals.netPayout, previousTotals.netPayout),
      },
      payout: {
        grossSales: totals.itemSales,
        taxableValue: totals.taxableValue,
        productGst: totals.productGst,
        gatewayFee: totals.gatewayFee,
        logisticsFee: totals.logisticsFee,
        commission: totals.commission,
        tds: totals.tds,
        tcs: totals.tcs,
        totalDeductions: totals.totalDeductions,
        netPayout: totals.netPayout,
        gatewayGst: totals.gatewayGst,
        logisticsGst: totals.logisticsGst,
        commissionGst: totals.commissionGst,
        inputGstCredits: totals.inputGstCredits,
        couponDiscounts: totals.couponDiscounts,
      },
      series,
      ...(options.includeOrders ? { orders: rows.map((r) => this.mapOrder(r)) } : {}),
    };
  }

  private mapOrder(r: OrderPayout) {
    const first = r.lines[0];
    const more = r.lines.length - 1;
    return {
      id: r.order.id,
      shortId: orderShortId(r.order.id),
      invoiceNumber: r.order.invoiceNumber,
      createdAt: r.order.createdAt.toISOString(),
      status: r.order.status,
      buyerName: r.order.buyer?.user?.name ?? null,
      title: first ? (more > 0 ? `${first.name} +${more} more` : first.name) : 'Order',
      thumbnailUrl: first?.imageUrl ?? null,
      units: r.units,
      itemSales: r.itemSales,
      couponDiscount: r.couponDiscount,
      totalDeductions: r.totalDeductions,
      netPayout: r.netPayout,
      items: r.lines.map((l) => ({
        name: l.name,
        variantLabel: l.variantLabel,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        imageUrl: l.imageUrl,
      })),
      breakdown: r.breakdown,
    };
  }
}
