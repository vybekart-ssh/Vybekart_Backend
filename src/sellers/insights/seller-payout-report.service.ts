import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ExcelJS from 'exceljs';
import { getVybeKartCompanyInfo } from '../../company/company-info';
import { SellerInsightsQueryDto } from '../dto/seller-insights-query.dto';
import { formatIstDay, istYmd, percentChange, toIstWallClock } from './insights-range.util';
import { OrderPayout, orderShortId } from './order-payout.util';
import { InsightsDataset, SellerInsightsService } from './seller-insights.service';

const C = {
  navy: 'FF0B1E5B',
  royal: 'FF003BFF',
  primary: 'FF1E88E5',
  primarySoft: 'FFE3F2FD',
  surfaceAlt: 'FFF7FAFD',
  section: 'FFF0F4F8',
  border: 'FFE2E8F0',
  text: 'FF1A1D24',
  muted: 'FF64748B',
  white: 'FFFFFFFF',
  green: 'FF047857',
  greenSoft: 'FFE8F8F1',
  red: 'FFC62828',
  amberSoft: 'FFFFF4E0',
  cyanSoft: 'FFE0F7FF',
  blueSoft: 'FFE8EEFF',
};

const INR = '"₹"#,##0.00;[Red]-"₹"#,##0.00';
const DATE_FMT = 'dd-mmm-yyyy';
const TIME_FMT = 'hh:mm AM/PM';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const STATUS_LABEL: Record<string, string> = {
  PAID: 'Paid',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
};
const STATUS_FILL: Record<string, string> = {
  PAID: C.cyanSoft,
  PACKED: C.amberSoft,
  SHIPPED: C.blueSoft,
  DELIVERED: C.greenSoft,
};
const PERIOD_LABEL: Record<string, string> = {
  daily: 'Daily (today)',
  weekly: 'Weekly (last 7 days)',
  monthly: 'Monthly (this month)',
  custom: 'Custom range',
};

type ColumnKind = 'text' | 'int' | 'inr' | 'date' | 'time' | 'pct';

interface ColumnSpec {
  header: string;
  width: number;
  kind: ColumnKind;
  total?: boolean;
  emphasis?: 'payout' | 'deduction';
}

const thinBorder = (argb = C.border): Partial<ExcelJS.Borders> => ({
  top: { style: 'thin', color: { argb } },
  left: { style: 'thin', color: { argb } },
  bottom: { style: 'thin', color: { argb } },
  right: { style: 'thin', color: { argb } },
});

const solid = (argb: string): ExcelJS.Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb },
});

@Injectable()
export class SellerPayoutReportService {
  constructor(
    private readonly insights: SellerInsightsService,
    private readonly config: ConfigService,
  ) {}

  async build(
    userId: string,
    query: SellerInsightsQueryDto,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const data = await this.insights.collect(userId, query);
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
    const store = data.seller.businessName
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'Store';
    const filename = `Vybekart_Payout_Report_${store}_${data.range.from}_to_${data.range.to}.xlsx`;
    return { buffer: Buffer.from(raw as ArrayBuffer), filename, mimeType: XLSX_MIME };
  }

  // ---------------------------------------------------------------- Summary

  private buildSummarySheet(
    wb: ExcelJS.Workbook,
    data: InsightsDataset,
    company: ReturnType<typeof getVybeKartCompanyInfo>,
    generatedAt: Date,
  ) {
    const ws = wb.addWorksheet('Summary', {
      properties: { tabColor: { argb: C.navy } },
      views: [{ showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    ws.columns = [{ width: 46 }, { width: 22 }, { width: 62 }];

    const { totals: t, previousTotals: p, range, seller } = data;
    const generatedLabel = this.formatIstDateTime(generatedAt);

    this.banner(ws, 1, 3, `${company.platformBrand} · Seller Payout & Sales Report`, C.navy, 18, 38);
    this.banner(
      ws,
      2,
      3,
      `${company.tradeName} (${company.platformBrand} platform) · Generated ${generatedLabel} IST`,
      C.primary,
      10,
      22,
    );

    let row = 4;
    row = this.sectionHeader(ws, row, 'Seller partner details');
    row = this.keyValues(ws, row, [
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

    row = this.sectionHeader(ws, row + 1, 'Report period');
    row = this.keyValues(ws, row, [
      ['Filter', PERIOD_LABEL[range.period] ?? range.period],
      ['From', formatIstDay(range.from)],
      ['To', formatIstDay(range.to)],
      ['Days covered', String(range.days)],
      ['Compared with', range.previous.label],
      ['Orders included', 'Paid, Packed, Shipped and Delivered (cancelled and returned orders excluded)'],
      ['Time zone', 'India Standard Time (IST, UTC+05:30)'],
    ]);

    row = this.sectionHeader(ws, row + 1, 'Key figures');
    const salesChange = percentChange(t.itemSales, p.itemSales);
    const kf: Array<[string, number | string, ColumnKind, string?]> = [
      ['Orders', t.orders, 'int', `Previous period: ${p.orders}`],
      ['Units sold', t.units, 'int'],
      ['Gross sales', t.itemSales, 'inr', salesChange == null ? 'No sales in the previous period' : `${salesChange >= 0 ? '+' : ''}${salesChange}% vs previous period`],
      ['Average order value', t.orders > 0 ? Math.round((t.itemSales / t.orders) * 100) / 100 : 0, 'inr'],
      ['Total deductions', -t.totalDeductions, 'inr'],
      ['Estimated net payout', t.netPayout, 'inr', 'Amount due to you for these orders'],
    ];
    for (const [label, value, kind, note] of kf) {
      const isPayout = label === 'Estimated net payout';
      this.figureRow(ws, row, label, value, kind, note, isPayout ? 'payout' : undefined);
      row++;
    }

    row = this.sectionHeader(ws, row + 1, 'Settlement breakdown');
    row = this.tableHeader(ws, row, ['Particulars', 'Amount (₹)', 'How it is calculated']);
    const settlement: Array<[string, number, string, ('payout' | 'deduction' | 'total')?]> = [
      ['Gross sales (customer price, incl. product GST)', t.itemSales, 'Sum of item price × quantity for your products'],
      ['Less: Payment gateway fees (incl. GST)', -t.gatewayFee, '2% of customer price + 18% GST on the fee', 'deduction'],
      ['Less: Logistics (incl. GST)', -t.logisticsFee, 'Seller-paid shipping: actual Delhivery fee (or ₹75 + GST estimate); buyer-paid: nil', 'deduction'],
      ['Less: Vybekart commission (incl. GST)', -t.commission, '5% of (price − gateway − logistics) + 18% GST; 0% while live reward is active', 'deduction'],
      ['Less: TDS (income tax)', -t.tds, '0.1% of taxable supply', 'deduction'],
      ['Less: TCS (GST)', -t.tcs, '0.5% of taxable supply', 'deduction'],
      ['Total deductions', -t.totalDeductions, 'Sum of the deductions above', 'total'],
      ['Estimated net payout', t.netPayout, 'Gross sales − total deductions', 'payout'],
    ];
    for (const [label, amount, note, style] of settlement) {
      this.figureRow(ws, row, label, amount, 'inr', note, style === 'total' ? undefined : style, style === 'total');
      row++;
    }

    row = this.sectionHeader(ws, row + 1, 'GST summary');
    row = this.tableHeader(ws, row, ['Particulars', 'Amount (₹)', 'Notes']);
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
      this.figureRow(ws, row, label, amount, 'inr', note);
      row++;
    }

    row = this.sectionHeader(ws, row + 1, 'Buyer payments (information)');
    row = this.tableHeader(ws, row, ['Particulars', 'Amount (₹)', 'Notes']);
    const buyer: Array<[string, number, string]> = [
      ['Total collected from buyers', t.totalCollected, 'Gross sales + buyer delivery charges − coupon discounts'],
      ['Delivery charges paid by buyers', t.buyerDeliveryFees, 'Passed through to the courier; not part of your payout'],
      ['Coupon discounts', t.couponDiscounts, 'Funded by Vybekart; does not reduce your payout'],
    ];
    for (const [label, amount, note] of buyer) {
      this.figureRow(ws, row, label, amount, 'inr', note);
      row++;
    }

    row = this.sectionHeader(ws, row + 1, 'Notes');
    const notes = [
      'All amounts are in Indian Rupees (₹) and are estimates until settlement is completed by Vybekart.',
      'Customer price is what the shopper paid for your products and includes product GST.',
      'Commission is calculated using your commission status at the time this report was generated.',
      'Logistics uses the actual Delhivery fee recorded on the order when the seller pays shipping; otherwise the standard ₹75 + 18% GST estimate.',
      'Use the Orders and Line items sheets for invoice-level reconciliation and GST filing support. Please consult your tax advisor before filing.',
    ];
    for (const note of notes) {
      ws.mergeCells(row, 1, row, 3);
      const cell = ws.getCell(row, 1);
      cell.value = `•  ${note}`;
      cell.font = { size: 10, color: { argb: C.muted } };
      cell.alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(row).height = 30;
      row++;
    }
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
      { header: 'Shipping paid by', width: 15, kind: 'text' },
      { header: 'Buyer delivery charge (₹)', width: 17, kind: 'inr', total: true },
      { header: 'Coupon code', width: 14, kind: 'text' },
      { header: 'Coupon discount (₹)', width: 16, kind: 'inr', total: true },
      { header: 'Total paid by buyer (₹)', width: 17, kind: 'inr', total: true },
      { header: 'Gateway fee incl. GST (₹)', width: 17, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Logistics incl. GST (₹)', width: 17, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Logistics basis', width: 16, kind: 'text' },
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
        r.sellerPaysShipping ? 'Seller' : 'Buyer',
        r.buyerDeliveryFee,
        o.couponCode ?? '',
        r.couponDiscount,
        r.totalPaid,
        r.gatewayFee,
        r.logisticsFee,
        r.logisticsSource === 'ACTUAL'
          ? 'Actual Delhivery fee'
          : r.logisticsSource === 'ESTIMATED'
            ? 'Estimated'
            : 'Paid by buyer',
        r.commission,
        r.tds,
        r.tcs,
        r.totalDeductions,
        r.netPayout,
        Math.round((r.gatewayGst + r.logisticsGst + r.commissionGst) * 100) / 100,
        o.razorpayPaymentId ?? '',
        o.packedAt ? toIstWallClock(o.packedAt) : '',
        o.shippedAt ? toIstWallClock(o.shippedAt) : '',
        o.deliveredAt ? toIstWallClock(o.deliveredAt) : '',
        o.carrierName ?? '',
        o.trackingId ?? '',
      ] as Array<string | number | Date>;
    });

    this.dataSheet(wb, 'Orders', C.primary, `Orders · ${data.range.label}`, data, columns, values, {
      freezeColumns: 3,
      emptyMessage: 'No paid orders in this period.',
      statusColumn: 7,
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
    const values: Array<Array<string | number | Date>> = [];
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
    this.dataSheet(wb, 'Line items', C.royal, `Line items (GST) · ${data.range.label}`, data, columns, values, {
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
    const values: Array<Array<string | number | Date>> = [];
    const start = data.range.gte.getTime();
    for (let i = 0; i < data.range.days; i++) {
      const dayInstant = new Date(start + i * 86_400_000);
      const key = istYmd(dayInstant);
      const agg = byDay.get(key);
      const [y, m, d] = key.split('-').map(Number);
      values.push([
        new Date(Date.UTC(y, m - 1, d)),
        agg?.orders ?? 0,
        agg?.units ?? 0,
        Math.round((agg?.sales ?? 0) * 100) / 100,
        Math.round((agg?.deductions ?? 0) * 100) / 100,
        Math.round((agg?.payout ?? 0) * 100) / 100,
      ]);
    }
    this.dataSheet(wb, 'Daily summary', C.green, `Day-wise summary · ${data.range.label}`, data, columns, values, {
      freezeColumns: 1,
      emptyMessage: 'No days in this period.',
    });
  }

  // --------------------------------------------------------------- Helpers

  private dataSheet(
    wb: ExcelJS.Workbook,
    name: string,
    tab: string,
    title: string,
    data: InsightsDataset,
    columns: ColumnSpec[],
    values: Array<Array<string | number | Date>>,
    opts: { freezeColumns: number; emptyMessage: string; statusColumn?: number },
  ): ExcelJS.Worksheet {
    const headerRow = 4;
    const ws = wb.addWorksheet(name, {
      properties: { tabColor: { argb: tab } },
      views: [{ state: 'frozen', xSplit: opts.freezeColumns, ySplit: headerRow, showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    ws.columns = columns.map((c) => ({ width: c.width }));
    const last = columns.length;

    this.banner(ws, 1, last, title, C.navy, 14, 30);
    this.banner(
      ws,
      2,
      last,
      `${data.seller.businessName}${data.seller.gstNumber ? ` · GSTIN ${data.seller.gstNumber}` : ''} · ${formatIstDay(data.range.from)} to ${formatIstDay(data.range.to)} · Amounts in ₹`,
      C.primary,
      10,
      20,
    );

    const hdr = ws.getRow(headerRow);
    columns.forEach((c, i) => {
      const cell = hdr.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, size: 10, color: { argb: C.white } };
      cell.fill = solid(c.emphasis === 'payout' ? C.green : c.emphasis === 'deduction' ? 'FF8E1B1B' : C.navy);
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = thinBorder(C.navy);
    });
    hdr.height = 34;

    if (values.length === 0) {
      const r = headerRow + 1;
      ws.mergeCells(r, 1, r, last);
      const cell = ws.getCell(r, 1);
      cell.value = opts.emptyMessage;
      cell.font = { italic: true, color: { argb: C.muted } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(r).height = 28;
      return ws;
    }

    values.forEach((rowValues, idx) => {
      const r = ws.getRow(headerRow + 1 + idx);
      const zebra = idx % 2 === 1;
      rowValues.forEach((v, ci) => {
        const spec = columns[ci];
        const cell = r.getCell(ci + 1);
        cell.value = v === '' ? null : v;
        this.applyKind(cell, spec.kind);
        cell.border = thinBorder();
        cell.font = {
          size: 10,
          color: {
            argb: spec.emphasis === 'payout' ? C.green : spec.emphasis === 'deduction' ? C.red : C.text,
          },
          bold: spec.emphasis === 'payout',
        };
        if (zebra) cell.fill = solid(C.surfaceAlt);
      });
      if (opts.statusColumn) {
        const status = String(rowValues[opts.statusColumn - 1] ?? '').toUpperCase();
        const fill = STATUS_FILL[status];
        const cell = r.getCell(opts.statusColumn);
        if (fill) cell.fill = solid(fill);
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { size: 10, bold: true, color: { argb: C.navy } };
      }
      r.height = 20;
    });

    const firstData = headerRow + 1;
    const lastData = headerRow + values.length;
    const totalRow = ws.getRow(lastData + 1);
    columns.forEach((c, i) => {
      const cell = totalRow.getCell(i + 1);
      const letter = ws.getColumn(i + 1).letter;
      if (i === 0) {
        cell.value = 'Total';
      } else if (c.total) {
        const result = values.reduce((s, row) => s + (typeof row[i] === 'number' ? (row[i] as number) : 0), 0);
        cell.value = {
          formula: `SUBTOTAL(109,${letter}${firstData}:${letter}${lastData})`,
          result: Math.round(result * 100) / 100,
        };
        this.applyKind(cell, c.kind);
      }
      cell.font = {
        bold: true,
        size: 10,
        color: { argb: c.emphasis === 'payout' ? C.green : c.emphasis === 'deduction' ? C.red : C.navy },
      };
      cell.fill = solid(c.emphasis === 'payout' ? C.greenSoft : C.primarySoft);
      cell.border = {
        top: { style: 'medium', color: { argb: C.navy } },
        bottom: { style: 'medium', color: { argb: C.navy } },
        left: { style: 'thin', color: { argb: C.border } },
        right: { style: 'thin', color: { argb: C.border } },
      };
    });
    totalRow.height = 24;

    ws.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: lastData, column: last },
    };
    return ws;
  }

  private applyKind(cell: ExcelJS.Cell, kind: ColumnKind) {
    switch (kind) {
      case 'inr':
        cell.numFmt = INR;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        break;
      case 'int':
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        break;
      case 'pct':
        cell.numFmt = '0.##"%"';
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        break;
      case 'date':
        cell.numFmt = DATE_FMT;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        break;
      case 'time':
        cell.numFmt = TIME_FMT;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        break;
      default:
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
    }
  }

  private banner(
    ws: ExcelJS.Worksheet,
    row: number,
    lastCol: number,
    text: string,
    fill: string,
    size: number,
    height: number,
  ) {
    ws.mergeCells(row, 1, row, lastCol);
    const cell = ws.getCell(row, 1);
    cell.value = text;
    cell.font = { bold: true, size, color: { argb: C.white } };
    cell.fill = solid(fill);
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(row).height = height;
  }

  private sectionHeader(ws: ExcelJS.Worksheet, row: number, title: string): number {
    ws.mergeCells(row, 1, row, 3);
    const cell = ws.getCell(row, 1);
    cell.value = title.toUpperCase();
    cell.font = { bold: true, size: 11, color: { argb: C.navy } };
    cell.fill = solid(C.section);
    cell.alignment = { vertical: 'middle', indent: 1 };
    cell.border = { bottom: { style: 'medium', color: { argb: C.primary } } };
    ws.getRow(row).height = 24;
    return row + 1;
  }

  private tableHeader(ws: ExcelJS.Worksheet, row: number, headers: string[]): number {
    headers.forEach((h, i) => {
      const cell = ws.getCell(row, i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 10, color: { argb: C.white } };
      cell.fill = solid(C.primary);
      cell.alignment = { vertical: 'middle', horizontal: i === 1 ? 'right' : 'left', indent: i === 1 ? 0 : 1 };
      cell.border = thinBorder(C.primary);
    });
    ws.getRow(row).height = 22;
    return row + 1;
  }

  private keyValues(ws: ExcelJS.Worksheet, row: number, pairs: Array<[string, string]>): number {
    for (const [k, v] of pairs) {
      const key = ws.getCell(row, 1);
      key.value = k;
      key.font = { size: 10, color: { argb: C.muted } };
      key.alignment = { vertical: 'middle', indent: 1 };
      ws.mergeCells(row, 2, row, 3);
      const val = ws.getCell(row, 2);
      val.value = v;
      val.font = { size: 10, bold: true, color: { argb: C.text } };
      val.alignment = { vertical: 'middle', wrapText: true };
      [1, 2].forEach((c) => (ws.getCell(row, c).border = { bottom: { style: 'hair', color: { argb: C.border } } }));
      ws.getRow(row).height = v.length > 70 ? 30 : 18;
      row++;
    }
    return row;
  }

  private figureRow(
    ws: ExcelJS.Worksheet,
    row: number,
    label: string,
    value: number | string,
    kind: ColumnKind,
    note?: string,
    emphasis?: 'payout' | 'deduction',
    bold = false,
  ) {
    const l = ws.getCell(row, 1);
    const v = ws.getCell(row, 2);
    const n = ws.getCell(row, 3);
    l.value = label;
    v.value = value;
    n.value = note ?? '';
    this.applyKind(v, kind);
    const isPayout = emphasis === 'payout';
    l.font = { size: 10, bold: bold || isPayout, color: { argb: isPayout ? C.green : C.text } };
    v.font = {
      size: isPayout ? 12 : 10,
      bold: true,
      color: { argb: isPayout ? C.green : emphasis === 'deduction' || (typeof value === 'number' && value < 0) ? C.red : C.text },
    };
    n.font = { size: 9, color: { argb: C.muted } };
    l.alignment = { vertical: 'middle', indent: 1, wrapText: true };
    n.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
    [l, v, n].forEach((c) => {
      c.border = thinBorder();
      if (isPayout) c.fill = solid(C.greenSoft);
      else if (bold) c.fill = solid(C.primarySoft);
    });
    ws.getRow(row).height = isPayout ? 26 : 20;
  }

  private formatIstDateTime(date: Date): string {
    const w = toIstWallClock(date);
    const h = w.getUTCHours();
    const min = String(w.getUTCMinutes()).padStart(2, '0');
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${formatIstDay(istYmd(date))}, ${h12}:${min} ${h < 12 ? 'AM' : 'PM'}`;
  }
}
