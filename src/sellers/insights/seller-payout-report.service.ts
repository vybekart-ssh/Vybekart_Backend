import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ExcelJS from 'exceljs';
import { getVybeKartCompanyInfo } from '../../company/company-info';
import { SellerInsightsQueryDto } from '../dto/seller-insights-query.dto';
import { formatIstDay, istYmd, percentChange, toIstWallClock } from './insights-range.util';
import { OrderPayout, orderShortId } from './order-payout.util';
import { InsightsDataset, SellerInsightsService } from './seller-insights.service';
import {
  C,
  CellValue,
  ColumnKind,
  ColumnSpec,
  dataSheet,
  figureRow,
  formatIstDateTime,
  istDateCell,
  keyValues,
  notesBlock,
  PERIOD_LABEL,
  round2,
  safeFilePart,
  sectionHeader,
  STATUS_LABEL,
  summarySheet,
  tableHeader,
  XLSX_MIME,
} from './excel-kit';

export interface ExcelReportFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

@Injectable()
export class SellerPayoutReportService {
  constructor(
    private readonly insights: SellerInsightsService,
    private readonly config: ConfigService,
  ) {}

  async build(userId: string, query: SellerInsightsQueryDto): Promise<ExcelReportFile> {
    return this.buildFromDataset(await this.insights.collect(userId, query));
  }

  /** Same workbook the seller downloads; also used by the admin "single seller" report. */
  async buildFromDataset(data: InsightsDataset): Promise<ExcelReportFile> {
    const company = getVybeKartCompanyInfo(this.config);
    const generatedAt = new Date();

    const wb = new ExcelJS.Workbook();
    wb.creator = `${company.platformBrand} (${company.tradeName})`;
    wb.company = company.tradeName;
    wb.title = `${company.platformBrand} seller payout report`;
    wb.created = generatedAt;

    const ordersRows = [...data.rows].sort(
      (a, b) => a.order.createdAt.getTime() - b.order.createdAt.getTime(),
    );

    this.buildSummarySheet(wb, data, company, generatedAt);
    this.buildOrdersSheet(wb, data, ordersRows);
    this.buildLineItemsSheet(wb, data, ordersRows);
    this.buildDailySheet(wb, data);

    const raw = await wb.xlsx.writeBuffer();
    const store = safeFilePart(data.seller.businessName, 'Store');
    const filename = `Vybekart_Payout_Report_${store}_${data.range.from}_to_${data.range.to}.xlsx`;
    return { buffer: Buffer.from(raw as ArrayBuffer), filename, mimeType: XLSX_MIME };
  }

  private subtitle(data: InsightsDataset): string {
    return `${data.seller.businessName}${data.seller.gstNumber ? ` · GSTIN ${data.seller.gstNumber}` : ''} · ${formatIstDay(data.range.from)} to ${formatIstDay(data.range.to)} · Amounts in ₹`;
  }

  // ---------------------------------------------------------------- Summary

  private buildSummarySheet(
    wb: ExcelJS.Workbook,
    data: InsightsDataset,
    company: ReturnType<typeof getVybeKartCompanyInfo>,
    generatedAt: Date,
  ) {
    const ws = summarySheet(
      wb,
      'Summary',
      `${company.platformBrand} · Seller Payout & Sales Report`,
      `${company.tradeName} (${company.platformBrand} platform) · Generated ${formatIstDateTime(generatedAt)} IST`,
    );

    const { totals: t, previousTotals: p, range, seller } = data;

    let row = 4;
    row = sectionHeader(ws, row, 'Seller partner details');
    row = keyValues(ws, row, [
      ['Store name', seller.businessName],
      ['Seller partner', seller.ownerName ?? '—'],
      ['Email', seller.email ?? '—'],
      ['Phone', seller.phone ?? '—'],
      ['GSTIN', seller.gstNumber ?? 'Not provided'],
      ['GST registration', data.ctx.gstRegistered ? 'Registered' : 'Not registered'],
      ['Business address', seller.businessAddress ?? '—'],
      [
        'Commission status (at report time)',
        data.ctx.commissionWaiverActive
          ? 'Live reward active — 0% Vybekart commission'
          : 'Standard — 5% Vybekart commission',
      ],
    ]);

    row = sectionHeader(ws, row + 1, 'Report period');
    row = keyValues(ws, row, [
      ['Filter', PERIOD_LABEL[range.period] ?? range.period],
      ['From', formatIstDay(range.from)],
      ['To', formatIstDay(range.to)],
      ['Days covered', String(range.days)],
      ['Compared with', range.previous.label],
      ['Orders included', 'Paid, Packed, Shipped and Delivered (cancelled and returned orders excluded)'],
      ['Time zone', 'India Standard Time (IST, UTC+05:30)'],
    ]);

    row = sectionHeader(ws, row + 1, 'Key figures');
    const salesChange = percentChange(t.itemSales, p.itemSales);
    const kf: Array<[string, number | string, ColumnKind, string?]> = [
      ['Orders', t.orders, 'int', `Previous period: ${p.orders}`],
      ['Units sold', t.units, 'int'],
      ['Gross sales', t.itemSales, 'inr', salesChange == null ? 'No sales in the previous period' : `${salesChange >= 0 ? '+' : ''}${salesChange}% vs previous period`],
      ['Average order value', t.orders > 0 ? round2(t.itemSales / t.orders) : 0, 'inr'],
      ['Total deductions', -t.totalDeductions, 'inr'],
      ['Estimated net payout', t.netPayout, 'inr', 'Amount due to you for these orders'],
    ];
    for (const [label, value, kind, note] of kf) {
      const isPayout = label === 'Estimated net payout';
      figureRow(ws, row, label, value, kind, note, isPayout ? 'payout' : undefined);
      row++;
    }

    row = sectionHeader(ws, row + 1, 'Settlement breakdown');
    row = tableHeader(ws, row, ['Particulars', 'Amount (₹)', 'How it is calculated']);
    const settlement: Array<[string, number, string, ('payout' | 'deduction' | 'total')?]> = [
      ['Gross sales (customer price, incl. product GST)', t.itemSales, 'Sum of item price × quantity for your products'],
      ['Less: Payment gateway fees (incl. GST)', -t.gatewayFee, '2% of customer price + 18% GST on the fee', 'deduction'],
      ['Less: Logistics (incl. GST)', -t.logisticsFee, `Flat ₹${data.ctx.logisticsBaseInr} + 18% GST per order`, 'deduction'],
      ['Less: Vybekart commission (incl. GST)', -t.commission, '5% of (price − gateway − logistics) + 18% GST; 0% while live reward is active', 'deduction'],
      ['Less: TDS (income tax)', -t.tds, '0.1% of taxable supply', 'deduction'],
      ['Less: TCS (GST)', -t.tcs, '0.5% of taxable supply', 'deduction'],
      ['Total deductions', -t.totalDeductions, 'Sum of the deductions above', 'total'],
      ['Estimated net payout', t.netPayout, 'Gross sales − total deductions', 'payout'],
    ];
    for (const [label, amount, note, style] of settlement) {
      figureRow(ws, row, label, amount, 'inr', note, style === 'total' ? undefined : style, style === 'total');
      row++;
    }

    row = sectionHeader(ws, row + 1, 'GST summary');
    row = tableHeader(ws, row, ['Particulars', 'Amount (₹)', 'Notes']);
    const gst: Array<[string, number, string]> = [
      ['Taxable value of supplies', t.taxableValue, data.ctx.gstRegistered ? 'Customer price excluding product GST (per product GST rate)' : 'Equals gross sales for GST-unregistered partners'],
      ['Product GST included in sales (output tax)', t.productGst, data.ctx.gstRegistered ? 'Report in GSTR-1 / GSTR-3B' : 'Not applicable (no GSTIN)'],
      ['GST on payment gateway fees', t.gatewayGst, 'Input tax credit (subject to invoices)'],
      ['GST on logistics', t.logisticsGst, 'Input tax credit (subject to invoices)'],
      ['GST on Vybekart commission', t.commissionGst, 'Input tax credit (subject to invoices)'],
      ['TCS collected under GST', t.tcs, 'Claimable in your GST electronic cash ledger'],
      ['Total input credits (info)', t.inputGstCredits, 'Gateway + logistics + commission GST + TCS'],
    ];
    for (const [label, amount, note] of gst) {
      figureRow(ws, row, label, amount, 'inr', note);
      row++;
    }

    row = sectionHeader(ws, row + 1, 'Coupons (information)');
    row = tableHeader(ws, row, ['Particulars', 'Amount (₹)', 'Notes']);
    figureRow(ws, row, 'Coupon discounts', t.couponDiscounts, 'inr', 'Funded by Vybekart; does not reduce your payout');
    row++;

    row = sectionHeader(ws, row + 1, 'Notes');
    notesBlock(ws, row, [
      'All amounts are in Indian Rupees (₹) and are estimates until settlement is completed by Vybekart.',
      'Customer price is what the shopper paid for your products and includes product GST.',
      'Commission is calculated using your commission status at the time this report was generated.',
      `Logistics is a flat ₹${data.ctx.logisticsBaseInr} + 18% GST deducted on every order.`,
      'Use the Orders and Line items sheets for invoice-level reconciliation and GST filing support. Please consult your tax advisor before filing.',
    ]);
  }

  // ---------------------------------------------------------------- Orders

  private buildOrdersSheet(wb: ExcelJS.Workbook, data: InsightsDataset, rows: OrderPayout[]) {
    const columns: ColumnSpec[] = [
      { header: 'S.No', width: 7, kind: 'int' },
      { header: 'Order ID', width: 38, kind: 'text' },
      { header: 'Short ID', width: 10, kind: 'text' },
      { header: 'Invoice No.', width: 18, kind: 'text' },
      { header: 'Order date', width: 13, kind: 'date' },
      { header: 'Order time (IST)', width: 14, kind: 'time' },
      { header: 'Status', width: 12, kind: 'text' },
      { header: 'Buyer', width: 22, kind: 'text' },
      { header: 'Ship-to address', width: 44, kind: 'text' },
      { header: 'Products', width: 40, kind: 'text' },
      { header: 'Units', width: 8, kind: 'int', total: true },
      { header: 'Gross sales (₹)', width: 15, kind: 'inr', total: true },
      { header: 'Taxable value (₹)', width: 16, kind: 'inr', total: true },
      { header: 'Product GST (₹)', width: 15, kind: 'inr', total: true },
      { header: 'Coupon code', width: 14, kind: 'text' },
      { header: 'Coupon discount (₹)', width: 16, kind: 'inr', total: true },
      { header: 'Gateway fee incl. GST (₹)', width: 17, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Logistics incl. GST (₹)', width: 17, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Commission incl. GST (₹)', width: 17, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'TDS (₹)', width: 11, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'TCS (₹)', width: 11, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Total deductions (₹)', width: 16, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Est. net payout (₹)', width: 17, kind: 'inr', total: true, emphasis: 'payout' },
      { header: 'GST on fees (₹)', width: 14, kind: 'inr', total: true },
      { header: 'Razorpay payment ID', width: 24, kind: 'text' },
      { header: 'Packed on', width: 13, kind: 'date' },
      { header: 'Shipped on', width: 13, kind: 'date' },
      { header: 'Delivered on', width: 13, kind: 'date' },
      { header: 'Carrier', width: 12, kind: 'text' },
      { header: 'Tracking ID', width: 18, kind: 'text' },
    ];

    const values = rows.map((r, i) => {
      const o = r.order;
      const wall = toIstWallClock(o.createdAt);
      return [
        i + 1,
        o.id,
        `#${orderShortId(o.id)}`,
        o.invoiceNumber ?? '',
        wall,
        wall,
        STATUS_LABEL[o.status] ?? o.status,
        o.buyer?.user?.name ?? '',
        (o.shippingAddress ?? '').replace(/\s*\n\s*/g, ', '),
        r.lines
          .map((l) => `${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ''} × ${l.quantity}`)
          .join('; '),
        r.units,
        r.itemSales,
        r.taxableValue,
        r.productGst,
        o.couponCode ?? '',
        r.couponDiscount,
        r.gatewayFee,
        r.logisticsFee,
        r.commission,
        r.tds,
        r.tcs,
        r.totalDeductions,
        r.netPayout,
        round2(r.gatewayGst + r.logisticsGst + r.commissionGst),
        o.razorpayPaymentId ?? '',
        o.packedAt ? toIstWallClock(o.packedAt) : '',
        o.shippedAt ? toIstWallClock(o.shippedAt) : '',
        o.deliveredAt ? toIstWallClock(o.deliveredAt) : '',
        o.carrierName ?? '',
        o.trackingId ?? '',
      ] as CellValue[];
    });

    dataSheet(wb, 'Orders', C.primary, `Orders · ${data.range.label}`, this.subtitle(data), columns, values, {
      freezeColumns: 3,
      emptyMessage: 'No paid orders in this period.',
      statusColumns: [7],
    });
  }

  // ------------------------------------------------------------ Line items

  private buildLineItemsSheet(wb: ExcelJS.Workbook, data: InsightsDataset, rows: OrderPayout[]) {
    const columns: ColumnSpec[] = [
      { header: 'S.No', width: 7, kind: 'int' },
      { header: 'Order ID', width: 38, kind: 'text' },
      { header: 'Invoice No.', width: 18, kind: 'text' },
      { header: 'Order date', width: 13, kind: 'date' },
      { header: 'Product', width: 36, kind: 'text' },
      { header: 'Variant', width: 16, kind: 'text' },
      { header: 'SKU', width: 16, kind: 'text' },
      { header: 'HSN code', width: 12, kind: 'text' },
      { header: 'GST rate (%)', width: 12, kind: 'pct' },
      { header: 'Qty', width: 8, kind: 'int', total: true },
      { header: 'Unit price incl. GST (₹)', width: 18, kind: 'inr' },
      { header: 'Line total (₹)', width: 15, kind: 'inr', total: true },
      { header: 'Taxable value (₹)', width: 16, kind: 'inr', total: true },
      { header: 'GST amount (₹)', width: 15, kind: 'inr', total: true },
    ];
    const values: CellValue[][] = [];
    let n = 1;
    for (const r of rows) {
      const wall = toIstWallClock(r.order.createdAt);
      for (const l of r.lines) {
        values.push([
          n++,
          r.order.id,
          r.order.invoiceNumber ?? '',
          wall,
          l.name,
          l.variantLabel ?? '',
          l.sku ?? '',
          l.hsnCode ?? '',
          l.gstRatePercent,
          l.quantity,
          l.unitPrice,
          l.lineTotal,
          l.taxableValue,
          l.gstAmount,
        ]);
      }
    }
    dataSheet(wb, 'Line items', C.royal, `Line items (GST) · ${data.range.label}`, this.subtitle(data), columns, values, {
      freezeColumns: 2,
      emptyMessage: 'No products sold in this period.',
    });
  }

  // ----------------------------------------------------------------- Daily

  private buildDailySheet(wb: ExcelJS.Workbook, data: InsightsDataset) {
    const columns: ColumnSpec[] = [
      { header: 'Date', width: 15, kind: 'date' },
      { header: 'Orders', width: 10, kind: 'int', total: true },
      { header: 'Units', width: 10, kind: 'int', total: true },
      { header: 'Gross sales (₹)', width: 17, kind: 'inr', total: true },
      { header: 'Total deductions (₹)', width: 18, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Est. net payout (₹)', width: 18, kind: 'inr', total: true, emphasis: 'payout' },
    ];
    const byDay = new Map<string, { orders: number; units: number; sales: number; deductions: number; payout: number }>();
    for (const r of data.rows) {
      const key = istYmd(r.order.createdAt);
      const agg = byDay.get(key) ?? { orders: 0, units: 0, sales: 0, deductions: 0, payout: 0 };
      agg.orders += 1;
      agg.units += r.units;
      agg.sales += r.itemSales;
      agg.deductions += r.totalDeductions;
      agg.payout += r.netPayout;
      byDay.set(key, agg);
    }
    const values: CellValue[][] = [];
    const start = data.range.gte.getTime();
    for (let i = 0; i < data.range.days; i++) {
      const key = istYmd(new Date(start + i * 86_400_000));
      const agg = byDay.get(key);
      values.push([
        istDateCell(key),
        agg?.orders ?? 0,
        agg?.units ?? 0,
        round2(agg?.sales ?? 0),
        round2(agg?.deductions ?? 0),
        round2(agg?.payout ?? 0),
      ]);
    }
    dataSheet(wb, 'Daily summary', C.green, `Day-wise summary · ${data.range.label}`, this.subtitle(data), columns, values, {
      freezeColumns: 1,
      emptyMessage: 'No days in this period.',
    });
  }
}
