import * as ExcelJS from 'exceljs';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@prisma/client';
import { buildInsightsBuckets, resolveInsightsRange } from './insights-range.util';
import {
  computeOrderPayout,
  InsightsOrderRow,
  PayoutContext,
  sumPayouts,
} from './order-payout.util';
import { SellerPayoutReportService } from './seller-payout-report.service';
import { InsightsDataset, SellerInsightsService } from './seller-insights.service';

// 12 Oct 2026, 17:48 IST
const NOW = new Date('2026-10-12T12:18:00.000Z');

function order(partial: Partial<InsightsOrderRow> & { id: string }): InsightsOrderRow {
  return {
    createdAt: new Date('2026-10-12T05:00:00.000Z'),
    status: OrderStatus.PAID,
    couponCode: null,
    couponDiscount: 0,
    invoiceNumber: null,
    razorpayPaymentId: null,
    trackingId: null,
    carrierName: null,
    packedAt: null,
    shippedAt: null,
    deliveredAt: null,
    shippingAddress: 'Flat 1, Andheri, Mumbai 400053',
    buyer: { user: { name: 'Asha' } },
    items: [],
    ...partial,
  } as InsightsOrderRow;
}

const item = (price: number, quantity: number, gstPercent: number | null = 12, sellerId = 's1') => ({
  quantity,
  price,
  variantLabel: 'M',
  product: {
    id: `p-${price}`,
    name: `Kurta ${price}`,
    sku: 'SKU-1',
    hsnCode: '6204',
    gstPercent,
    images: [],
    sellerId,
  },
});

describe('resolveInsightsRange (IST)', () => {
  it('daily is today vs yesterday with 3-hour buckets', () => {
    const r = resolveInsightsRange('daily', undefined, undefined, NOW);
    expect(r.from).toBe('2026-10-12');
    expect(r.to).toBe('2026-10-12');
    expect(r.gte.toISOString()).toBe('2026-10-11T18:30:00.000Z');
    expect(r.lt.toISOString()).toBe('2026-10-12T18:30:00.000Z');
    expect(r.previous.from).toBe('2026-10-11');
    expect(r.granularity).toBe('hour3');
    expect(buildInsightsBuckets(r)).toHaveLength(8);
  });

  it('weekly is the last 7 days including today', () => {
    const r = resolveInsightsRange('weekly', undefined, undefined, NOW);
    expect(r.from).toBe('2026-10-06');
    expect(r.previous.from).toBe('2026-09-29');
    expect(r.previous.to).toBe('2026-10-05');
    expect(buildInsightsBuckets(r)).toHaveLength(7);
  });

  it('monthly is month-to-date vs the same span last month', () => {
    const r = resolveInsightsRange('monthly', undefined, undefined, NOW);
    expect(r.from).toBe('2026-10-01');
    expect(r.days).toBe(12);
    expect(r.previous.from).toBe('2026-09-01');
    expect(r.previous.to).toBe('2026-09-12');
  });

  it('custom validates and picks granularity by span', () => {
    const r = resolveInsightsRange('custom', '2026-01-01', '2026-10-12', NOW);
    expect(r.granularity).toBe('month');
    expect(buildInsightsBuckets(r)).toHaveLength(10);
    expect(() => resolveInsightsRange('custom', '2026-10-10', '2026-10-01', NOW)).toThrow();
    expect(() => resolveInsightsRange('custom', '2026-10-01', '2026-10-20', NOW)).toThrow();
    expect(() => resolveInsightsRange('custom', '2024-01-01', '2026-10-12', NOW)).toThrow();
  });
});

describe('computeOrderPayout', () => {
  const ctx: PayoutContext = {
    sellerId: 's1',
    gstRegistered: true,
    commissionWaiverActive: false,
    logisticsBaseInr: 75,
  };

  it('adds up: sales − deductions = net payout, with flat ₹75 + GST logistics', () => {
    const r = computeOrderPayout(
      order({ id: 'o1', items: [item(1000, 2), item(500, 1, null, 'other')] }),
      ctx,
    );
    expect(r.itemSales).toBe(2000);
    expect(r.units).toBe(2);
    expect(r.logisticsFee).toBe(88.5);
    expect(r.taxableValue).toBe(1785.71);
    expect(r.netPayout).toBe(
      Math.round((r.itemSales - r.gatewayFee - r.logisticsFee - r.commission - r.tds - r.tcs) * 100) / 100,
    );
    expect(r.breakdown.netSettlement).toBe(r.netPayout);
    const logistics = r.breakdown.deductions.find((d) => d.key === 'logistics');
    expect(logistics?.label).toBe('Logistics');
    expect(JSON.stringify(r.breakdown)).not.toMatch(/Delhivery/i);
  });

  it('matches the add-product estimate for ₹1,000 (GST-unregistered)', () => {
    const r = computeOrderPayout(order({ id: 'o2', items: [item(1000, 1)] }), { ...ctx, gstRegistered: false });
    expect(r.gatewayFee).toBe(23.6);
    expect(r.logisticsFee).toBe(88.5);
    expect(r.commission).toBe(52.39);
    expect(r.tds).toBe(1);
    expect(r.tcs).toBe(5);
    expect(r.productGst).toBe(0);
    expect(r.netPayout).toBe(829.51);
  });
});

describe('SellerPayoutReportService', () => {
  it('builds a readable workbook with every order and line row', async () => {
    const ctx: PayoutContext = {
      sellerId: 's1',
      gstRegistered: true,
      commissionWaiverActive: false,
      logisticsBaseInr: 75,
    };
    const rows = [
      computeOrderPayout(order({ id: 'order-aaaa-1111', items: [item(1000, 2), item(450, 1)], invoiceNumber: 'VK/26/0001' }), ctx),
      computeOrderPayout(order({ id: 'order-bbbb-2222', createdAt: new Date('2026-10-09T10:00:00.000Z'), status: OrderStatus.DELIVERED, items: [item(799, 1)] }), ctx),
    ];
    const range = resolveInsightsRange('weekly', undefined, undefined, NOW);
    const dataset: InsightsDataset = {
      seller: {
        id: 's1',
        businessName: 'Opus Store',
        gstNumber: '27AAAAA0000A1Z5',
        businessAddress: 'Mumbai',
        commissionWaiverActive: false,
        ownerName: 'Vishal',
        email: 'vishal@example.com',
        phone: '+919999999999',
      },
      range,
      ctx,
      rows,
      totals: sumPayouts(rows),
      previousTotals: sumPayouts([]),
    };
    const insights = { collect: jest.fn().mockResolvedValue(dataset) } as unknown as SellerInsightsService;
    const service = new SellerPayoutReportService(insights, new ConfigService());

    const { buffer, filename } = await service.build('u1', { period: 'weekly' });
    expect(filename).toBe('Vybekart_Payout_Report_Opus_Store_2026-10-06_to_2026-10-12.xlsx');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Orders', 'Line items', 'Daily summary']);

    const orders = wb.getWorksheet('Orders')!;
    // banner, subtitle, blank, header, 2 orders, total
    expect(orders.getCell(5, 2).value).toBe('order-bbbb-2222');
    expect(orders.getCell(6, 2).value).toBe('order-aaaa-1111');
    expect(orders.getCell(7, 1).value).toBe('Total');
    const headers = (orders.getRow(4).values as unknown[]).join('|');
    expect(headers).not.toMatch(/Delhivery|delivery charge|paid by buyer|Shipping paid by/i);

    const lines = wb.getWorksheet('Line items')!;
    expect(lines.getCell(7, 1).value).toBe(3);
    expect(lines.getCell(8, 1).value).toBe('Total');

    const daily = wb.getWorksheet('Daily summary')!;
    expect((daily.getCell(11, 1).value as Date).toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(daily.getCell(12, 1).value).toBe('Total');
  });
});
