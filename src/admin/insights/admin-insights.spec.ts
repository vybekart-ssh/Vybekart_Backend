import * as ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, ShippingPayer, VerificationStatus } from '@prisma/client';
import { resolveInsightsRange } from '../../sellers/insights/insights-range.util';
import { PayoutContext, sumPayouts } from '../../sellers/insights/order-payout.util';
import { SellerInsightsService } from '../../sellers/insights/seller-insights.service';
import { SellerPayoutReportService } from '../../sellers/insights/seller-payout-report.service';
import {
  AdminDataset,
  AdminInsightsService,
  AdminOrderRow,
  AdminSellerRow,
  computeAdminOrder,
  sumPlatform,
} from './admin-insights.service';
import { AdminReportService } from './admin-report.service';

const NOW = new Date('2026-10-12T12:18:00.000Z');

function seller(id: string, name: string, gstNumber: string | null = null): AdminSellerRow {
  return {
    id,
    businessName: name,
    logoUrl: null,
    gstNumber,
    businessAddress: 'Mumbai',
    commissionWaiverActive: false,
    status: VerificationStatus.VERIFIED,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    bankAccount: '123456789012',
    bankName: 'HDFC Bank',
    accountHolderName: `${name} Owner`,
    accountType: 'CURRENT',
    ifscCode: 'HDFC0000123',
    user: { name: `${name} Owner`, email: `${id}@example.com`, phone: '+919999999999' },
  };
}

const item = (price: number, quantity: number, sellerId: string) => ({
  quantity,
  price,
  variantLabel: null,
  product: { id: `p-${sellerId}-${price}`, name: `Item ${price}`, sku: null, hsnCode: null, gstPercent: 12, images: [], sellerId },
});

function order(partial: Partial<AdminOrderRow> & { id: string }): AdminOrderRow {
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
    shippingAddress: 'Andheri, Mumbai',
    totalAmount: 0,
    deliveryFee: 0,
    shippingPayer: ShippingPayer.SELLER_PAYS,
    streamId: null,
    buyer: { id: 'b1', user: { name: 'Asha', email: 'asha@example.com', phone: '+918888888888' } },
    items: [],
    ...partial,
  } as AdminOrderRow;
}

const s1 = seller('11111111-1111-4111-8111-111111111111', 'Opus Store');
const s2 = seller('22222222-2222-4222-8222-222222222222', 'Kala Crafts', '27AAAAA0000A1Z5');
const ctxFor = (s: AdminSellerRow): PayoutContext => ({
  sellerId: s.id,
  gstRegistered: Boolean(s.gstNumber),
  commissionWaiverActive: false,
  logisticsBaseInr: 75,
});
const sellerMap = new Map([s1, s2].map((s) => [s.id, { seller: s, ctx: ctxFor(s) }]));

const multi = order({
  id: 'order-multi-0001',
  items: [item(1000, 1, s1.id), item(500, 2, s2.id)],
  shippingPayer: ShippingPayer.BUYER_PAYS,
  deliveryFee: 90,
  couponCode: 'VYBE50',
  couponDiscount: 50,
  totalAmount: 2040,
});
const single = order({
  id: 'order-single-0002',
  createdAt: new Date('2026-10-10T09:00:00.000Z'),
  status: OrderStatus.DELIVERED,
  items: [item(1000, 1, s1.id)],
  deliveryFee: 110,
  totalAmount: 1000,
});

describe('admin order maths', () => {
  it('splits a multi-seller order and keeps buyer / Delhivery amounts at order level', () => {
    const r = computeAdminOrder(multi, sellerMap)!;
    expect(r.parts).toHaveLength(2);
    expect(r.itemSales).toBe(2000);
    expect(r.logisticsFee).toBe(177);
    expect(r.buyerDeliveryFee).toBe(90);
    expect(r.delhiveryFee).toBe(90);
    expect(r.totalPaid).toBe(2040);
    expect(r.sellerPayout).toBe(
      Math.round((r.parts[0].payout.netPayout + r.parts[1].payout.netPayout) * 100) / 100,
    );
    expect(r.sellerPayout).toBe(Math.round((r.itemSales - r.totalDeductions) * 100) / 100);
  });

  it('filters to one seller', () => {
    const r = computeAdminOrder(multi, sellerMap, s2.id)!;
    expect(r.parts).toHaveLength(1);
    expect(r.itemSales).toBe(1000);
    expect(r.logisticsFee).toBe(88.5);
  });

  it('totals the platform: collected, logistics net and contribution', () => {
    const rows = [computeAdminOrder(multi, sellerMap)!, computeAdminOrder(single, sellerMap)!];
    const t = sumPlatform(rows);
    expect(t.orders).toBe(2);
    expect(t.buyers).toBe(1);
    expect(t.activeSellers).toBe(2);
    expect(t.gmv).toBe(3000);
    expect(t.totalCollected).toBe(3040);
    expect(t.buyerDeliveryFees).toBe(90);
    expect(t.delhiveryCost).toBe(200);
    expect(t.logisticsFee).toBe(265.5);
    expect(t.logisticsNet).toBe(155.5);
    expect(t.sellerPayouts).toBe(Math.round((t.gmv - t.sellerDeductions) * 100) / 100);
    expect(t.platformContribution).toBe(
      Math.round((t.commission - t.commissionGst + t.logisticsNet - t.couponDiscounts) * 100) / 100,
    );
  });
});

describe('AdminReportService', () => {
  const rows = [computeAdminOrder(multi, sellerMap)!, computeAdminOrder(single, sellerMap)!];
  const s1Rows = rows.flatMap((r) => r.parts.filter((p) => p.seller.id === s1.id).map((p) => p.payout));
  const s2Rows = rows.flatMap((r) => r.parts.filter((p) => p.seller.id === s2.id).map((p) => p.payout));
  const dataset: AdminDataset = {
    range: resolveInsightsRange('weekly', undefined, undefined, NOW),
    scope: { seller: null, status: null },
    logisticsBaseInr: 75,
    rows,
    totals: sumPlatform(rows),
    previousTotals: sumPlatform([]),
    sellers: [
      { seller: s1, rows: s1Rows, totals: sumPayouts(s1Rows) },
      { seller: s2, rows: s2Rows, totals: sumPayouts(s2Rows) },
    ],
    statusCounts: { PAID: 1, PACKED: 0, SHIPPED: 0, DELIVERED: 1, CANCELLED: 0, RETURNED: 0 },
  };
  const adminInsights = { collect: jest.fn().mockResolvedValue(dataset) } as unknown as AdminInsightsService;
  const sellerInsights = { collectForSeller: jest.fn() } as unknown as SellerInsightsService;
  const service = new AdminReportService(
    adminInsights,
    sellerInsights,
    new SellerPayoutReportService(sellerInsights, new ConfigService()),
    new ConfigService(),
  );

  const load = async (buffer: Buffer) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    return wb;
  };
  const headers = (ws: ExcelJS.Worksheet) => (ws.getRow(4).values as unknown[]).filter(Boolean).map(String);

  it('overview: summary, sellers, orders (with real Delhivery charge) and daily sheets', async () => {
    const { buffer, filename } = await service.build({ type: 'overview', period: 'weekly' });
    expect(filename).toBe('Vybekart_Admin_Platform_Overview_2026-10-06_to_2026-10-12.xlsx');
    const wb = await load(buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Sellers', 'Orders', 'Daily summary']);
    const orders = wb.getWorksheet('Orders')!;
    expect(headers(orders)).toContain('Actual Delhivery charge (₹)');
    expect(orders.getCell(5, 2).value).toBe('order-single-0002');
    expect(orders.getCell(6, 12).value).toBe('Opus Store; Kala Crafts');
    expect(headers(wb.getWorksheet('Sellers')!)).not.toContain('Account number');
  });

  it('sellers: payouts with bank details and per-seller orders', async () => {
    const { buffer } = await service.build({ type: 'sellers', period: 'weekly' });
    const wb = await load(buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Seller payouts', 'Seller orders']);
    const payouts = wb.getWorksheet('Seller payouts')!;
    expect(headers(payouts)).toContain('Account number');
    expect(payouts.getCell(5, 2).value).toBe('Opus Store');
    expect(wb.getWorksheet('Seller orders')!.getCell(8, 1).value).toBe('Total');
  });

  it('orders: register + line items', async () => {
    const { buffer } = await service.build({ type: 'orders', period: 'weekly' });
    const wb = await load(buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Orders', 'Line items']);
    expect(wb.getWorksheet('Line items')!.getCell(8, 1).value).toBe('Total');
  });

  it('seller report needs a seller', async () => {
    await expect(service.build({ type: 'seller', period: 'weekly' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
