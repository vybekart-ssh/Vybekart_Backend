import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ExcelJS from 'exceljs';
import { getVybeKartCompanyInfo } from '../../company/company-info';
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
} from '../../sellers/insights/excel-kit';
import { formatIstDay, istYmd, percentChange, toIstWallClock } from '../../sellers/insights/insights-range.util';
import { orderShortId } from '../../sellers/insights/order-payout.util';
import {
  ExcelReportFile,
  SellerPayoutReportService,
} from '../../sellers/insights/seller-payout-report.service';
import { SellerInsightsService } from '../../sellers/insights/seller-insights.service';
import { AdminReportQueryDto, AdminReportType } from '../dto/admin-insights-query.dto';
import { AdminDataset, AdminInsightsService, AdminOrderPayout, AdminSellerRow } from './admin-insights.service';

type Company = ReturnType<typeof getVybeKartCompanyInfo>;

const REPORT_TITLE: Record<Exclude<AdminReportType, 'seller'>, string> = {
  overview: 'Platform Sales & Earnings Report',
  sellers: 'Seller Partner Payouts (Settlement) Report',
  orders: 'Orders Register',
};
const REPORT_FILE: Record<Exclude<AdminReportType, 'seller'>, string> = {
  overview: 'Platform_Overview',
  sellers: 'Seller_Payouts',
  orders: 'Orders_Register',
};

const sellerLabel = (s: AdminSellerRow) => s.businessName || s.user?.name || 'Seller partner';
const commissionLabel = (s: AdminSellerRow) =>
  s.commissionWaiverActive ? '0% (live reward)' : '5% standard';

@Injectable()
export class AdminReportService {
  constructor(
    private readonly adminInsights: AdminInsightsService,
    private readonly sellerInsights: SellerInsightsService,
    private readonly sellerReport: SellerPayoutReportService,
    private readonly config: ConfigService,
  ) {}

  async build(query: AdminReportQueryDto): Promise<ExcelReportFile> {
    const type: AdminReportType = query.type ?? 'overview';

    if (type === 'seller') {
      if (!query.sellerId) {
        throw new BadRequestException('Choose a seller partner for the seller payout report');
      }
      const data = await this.sellerInsights.collectForSeller(query.sellerId, query);
      return this.sellerReport.buildFromDataset(data);
    }

    const data = await this.adminInsights.collect(query, {
      status: type === 'orders' ? query.status : undefined,
    });
    const company = getVybeKartCompanyInfo(this.config);
    const generatedAt = new Date();

    const wb = new ExcelJS.Workbook();
    wb.creator = `${company.platformBrand} (${company.tradeName})`;
    wb.company = company.tradeName;
    wb.title = `${company.platformBrand} ${REPORT_TITLE[type]}`;
    wb.created = generatedAt;

    const chronological = [...data.rows].sort(
      (a, b) => a.order.createdAt.getTime() - b.order.createdAt.getTime(),
    );

    switch (type) {
      case 'overview':
        this.buildOverviewSummary(wb, data, company, generatedAt);
        this.buildSellersSheet(wb, data, false);
        this.buildOrdersSheet(wb, data, chronological);
        this.buildDailySheet(wb, data);
        break;
      case 'sellers':
        this.buildSettlementSummary(wb, data, company, generatedAt);
        this.buildSellersSheet(wb, data, true);
        this.buildSellerOrdersSheet(wb, data, chronological);
        break;
      case 'orders':
        this.buildOrdersSheet(wb, data, chronological);
        this.buildLineItemsSheet(wb, data, chronological);
        break;
    }

    const raw = await wb.xlsx.writeBuffer();
    const scope = data.scope.seller ? `_${safeFilePart(data.scope.seller.businessName, 'Seller')}` : '';
    const status = data.scope.status ? `_${data.scope.status}` : '';
    const filename = `Vybekart_Admin_${REPORT_FILE[type]}${scope}${status}_${data.range.from}_to_${data.range.to}.xlsx`;
    return { buffer: Buffer.from(raw as ArrayBuffer), filename, mimeType: XLSX_MIME };
  }

  // ---------------------------------------------------------------- Shared

  private subtitle(data: AdminDataset): string {
    const scope = data.scope.seller ? sellerLabel(data.scope.seller) : 'All seller partners';
    const status = data.scope.status ? ` · ${STATUS_LABEL[data.scope.status]} orders` : '';
    return `${scope}${status} · ${formatIstDay(data.range.from)} to ${formatIstDay(data.range.to)} · Amounts in ₹ · Internal`;
  }

  private header(
    wb: ExcelJS.Workbook,
    data: AdminDataset,
    company: Company,
    generatedAt: Date,
    title: string,
  ): { ws: ExcelJS.Worksheet; row: number } {
    const ws = summarySheet(
      wb,
      'Summary',
      `${company.platformBrand} · ${title}`,
      `${company.tradeName} · Internal & confidential · Generated ${formatIstDateTime(generatedAt)} IST`,
    );
    const { range } = data;
    let row = sectionHeader(ws, 4, 'Report scope');
    row = keyValues(ws, row, [
      ['Filter', PERIOD_LABEL[range.period] ?? range.period],
      ['From', formatIstDay(range.from)],
      ['To', formatIstDay(range.to)],
      ['Days covered', String(range.days)],
      ['Compared with', range.previous.label],
      ['Seller partners', data.scope.seller ? sellerLabel(data.scope.seller) : 'All seller partners'],
      [
        'Orders included',
        data.scope.status
          ? `${STATUS_LABEL[data.scope.status]} only`
          : 'Paid, Packed, Shipped and Delivered (unpaid, cancelled and returned excluded)',
      ],
      ['Time zone', 'India Standard Time (IST, UTC+05:30)'],
    ]);
    return { ws, row };
  }

  private figures(
    ws: ExcelJS.Worksheet,
    row: number,
    rows: Array<[string, number | string, ColumnKind, string?, ('payout' | 'deduction' | 'earning' | 'total')?]>,
  ): number {
    for (const [label, value, kind, note, style] of rows) {
      figureRow(ws, row, label, value, kind, note, style === 'total' ? undefined : style, style === 'total');
      row++;
    }
    return row;
  }

  private change(current: number, previous: number): string {
    const c = percentChange(current, previous);
    if (c == null) return 'Nothing in the previous period';
    return `${c >= 0 ? '+' : ''}${c}% vs previous period`;
  }

  // ---------------------------------------------------- Overview summary

  private buildOverviewSummary(wb: ExcelJS.Workbook, data: AdminDataset, company: Company, generatedAt: Date) {
    const { ws, row: start } = this.header(wb, data, company, generatedAt, REPORT_TITLE.overview);
    const { totals: t, previousTotals: p } = data;
    let row = start;

    row = sectionHeader(ws, row + 1, 'Key figures');
    row = this.figures(ws, row, [
      ['Orders', t.orders, 'int', this.change(t.orders, p.orders)],
      ['Units sold', t.units, 'int'],
      ['Unique buyers', t.buyers, 'int', `Previous period: ${p.buyers}`],
      ['Seller partners with sales', t.activeSellers, 'int', `Previous period: ${p.activeSellers}`],
      ['Gross merchandise value (GMV)', t.gmv, 'inr', this.change(t.gmv, p.gmv)],
      ['Average order value', t.orders > 0 ? round2(t.gmv / t.orders) : 0, 'inr'],
      ['Total collected from buyers', t.totalCollected, 'inr', 'Order totals charged through Razorpay'],
    ]);

    row = sectionHeader(ws, row + 1, 'Buyer payments');
    row = tableHeader(ws, row, ['Particulars', 'Amount (₹)', 'Notes']);
    row = this.figures(ws, row, [
      ['GMV (customer price, incl. product GST)', t.gmv, 'inr', 'Item price × quantity for every product sold'],
      ['Add: Delivery charges paid by buyers', t.buyerDeliveryFees, 'inr', 'Buyer-pays orders only'],
      ['Less: Coupon discounts (Vybekart-funded)', -t.couponDiscounts, 'inr', 'Does not reduce seller payouts', 'deduction'],
      ['Total collected from buyers', t.totalCollected, 'inr', 'Sum of order totals', 'total'],
    ]);

    row = sectionHeader(ws, row + 1, 'Seller partner settlement');
    row = tableHeader(ws, row, ['Particulars', 'Amount (₹)', 'How it is calculated']);
    row = this.figures(ws, row, [
      ['GMV', t.gmv, 'inr'],
      ['Less: Payment gateway fees (incl. GST)', -t.gatewayFee, 'inr', '2% of customer price + 18% GST', 'deduction'],
      ['Less: Logistics (incl. GST)', -t.logisticsFee, 'inr', `Flat ₹${data.logisticsBaseInr} + 18% GST per order per seller`, 'deduction'],
      ['Less: Vybekart commission (incl. GST)', -t.commission, 'inr', '5% of (price − gateway − logistics) + 18% GST; 0% on live reward', 'deduction'],
      ['Less: TDS (income tax)', -t.tds, 'inr', '0.1% of taxable supply', 'deduction'],
      ['Less: TCS (GST)', -t.tcs, 'inr', '0.5% of taxable supply', 'deduction'],
      ['Total seller deductions', -t.sellerDeductions, 'inr', 'Sum of the deductions above', 'total'],
      ['Estimated payouts due to seller partners', t.sellerPayouts, 'inr', 'GMV − seller deductions', 'payout'],
    ]);

    row = sectionHeader(ws, row + 1, 'Vybekart earnings (estimate)');
    row = tableHeader(ws, row, ['Particulars', 'Amount (₹)', 'Notes']);
    row = this.figures(ws, row, [
      ['Commission (incl. GST)', t.commission, 'inr', this.change(t.commission, p.commission)],
      ['Less: GST on commission (payable)', -t.commissionGst, 'inr', 'Output GST to be deposited', 'deduction'],
      ['Commission net of GST', round2(t.commission - t.commissionGst), 'inr', undefined, 'total'],
      ['Logistics recovered from seller partners', t.logisticsFee, 'inr', `₹${data.logisticsBaseInr} + GST per order`],
      ['Delivery charges paid by buyers', t.buyerDeliveryFees, 'inr'],
      ['Less: Actual Delhivery charges', -t.delhiveryCost, 'inr', 'Delhivery fee recorded at checkout (all orders)', 'deduction'],
      ['Logistics net', t.logisticsNet, 'inr', 'Recovered + buyer-paid − actual Delhivery', 'total'],
      ['Less: Coupon cost', -t.couponDiscounts, 'inr', 'Vybekart-funded discounts', 'deduction'],
      ['Estimated platform contribution', t.platformContribution, 'inr', 'Commission net of GST + logistics net − coupons (before Razorpay and operating costs)', 'earning'],
      ['Gateway fees recovered from seller partners', t.gatewayFee, 'inr', 'Offsets Razorpay charges (information)'],
    ]);

    row = sectionHeader(ws, row + 1, 'Taxes withheld');
    row = tableHeader(ws, row, ['Particulars', 'Amount (₹)', 'Notes']);
    row = this.figures(ws, row, [
      ['TDS withheld (Section 194-O)', t.tds, 'inr', 'Deposit and file TDS returns'],
      ['TCS collected under GST (Section 52)', t.tcs, 'inr', 'Report in GSTR-8'],
      ['Taxable value of supplies', t.taxableValue, 'inr', 'Customer price excl. product GST (GST-registered sellers)'],
      ['Product GST in GMV', t.productGst, 'inr', 'Output tax of GST-registered sellers'],
    ]);

    row = sectionHeader(ws, row + 1, 'Orders by status (created in period)');
    row = tableHeader(ws, row, ['Status', 'Orders', 'Notes']);
    const statusNotes: Record<string, string> = {
      PAID: 'Waiting for the seller to pack',
      PACKED: 'Packed, pickup pending',
      SHIPPED: 'With Delhivery',
      DELIVERED: 'Completed',
      CANCELLED: 'Not counted in sales',
      RETURNED: 'Not counted in sales',
    };
    for (const [status, count] of Object.entries(data.statusCounts)) {
      figureRow(ws, row, STATUS_LABEL[status] ?? status, count, 'int', statusNotes[status]);
      row++;
    }

    row = sectionHeader(ws, row + 1, 'Notes');
    notesBlock(ws, row, [
      'Internal report for the Vybekart team. Do not share with seller partners or buyers.',
      'Seller payouts use the same calculator as the seller app (commission status at report time).',
      `Sellers are charged a flat ₹${data.logisticsBaseInr} + 18% GST logistics per order; the actual Delhivery charge is shown only in admin reports.`,
      data.scope.seller
        ? 'Seller filter: sales and payouts cover only this seller partner; buyer totals and Delhivery charges are for the whole order.'
        : 'Multi-seller orders appear once in Orders and once per seller in the Sellers sheet.',
    ]);
  }

  // -------------------------------------------------- Settlement summary

  private buildSettlementSummary(wb: ExcelJS.Workbook, data: AdminDataset, company: Company, generatedAt: Date) {
    const { ws, row: start } = this.header(wb, data, company, generatedAt, REPORT_TITLE.sellers);
    const t = data.totals;
    let row = sectionHeader(ws, start + 1, 'Settlement totals');
    row = tableHeader(ws, row, ['Particulars', 'Amount (₹)', 'Notes']);
    row = this.figures(ws, row, [
      ['Seller partners with sales', t.activeSellers, 'int'],
      ['Orders', t.orders, 'int'],
      ['GMV', t.gmv, 'inr'],
      ['Payment gateway fees (incl. GST)', -t.gatewayFee, 'inr', undefined, 'deduction'],
      ['Logistics (incl. GST)', -t.logisticsFee, 'inr', undefined, 'deduction'],
      ['Vybekart commission (incl. GST)', -t.commission, 'inr', undefined, 'deduction'],
      ['TDS', -t.tds, 'inr', undefined, 'deduction'],
      ['TCS', -t.tcs, 'inr', undefined, 'deduction'],
      ['Total deductions', -t.sellerDeductions, 'inr', undefined, 'total'],
      ['Total payouts due', t.sellerPayouts, 'inr', 'Transfer per seller using the Seller payouts sheet', 'payout'],
    ]);
    row = sectionHeader(ws, row + 1, 'Notes');
    notesBlock(ws, row, [
      'Contains bank details. Keep this file confidential and delete it after settlement.',
      'Payouts are estimates until returns and replacements for these orders are closed.',
      'Seller orders sheet lists every order per seller for reconciliation.',
    ]);
  }

  // ---------------------------------------------------------------- Sellers

  private buildSellersSheet(wb: ExcelJS.Workbook, data: AdminDataset, withBank: boolean) {
    const columns: ColumnSpec[] = [
      { header: 'S.No', width: 7, kind: 'int' },
      { header: 'Store', width: 28, kind: 'text' },
      { header: 'Seller partner', width: 22, kind: 'text' },
      { header: 'Phone', width: 16, kind: 'text' },
      { header: 'Email', width: 28, kind: 'text' },
      { header: 'GSTIN', width: 18, kind: 'text' },
      { header: 'Status', width: 13, kind: 'text' },
      { header: 'Commission', width: 15, kind: 'text' },
      { header: 'Orders', width: 9, kind: 'int', total: true },
      { header: 'Units', width: 9, kind: 'int', total: true },
      { header: 'GMV (₹)', width: 15, kind: 'inr', total: true },
      { header: 'Share of GMV (%)', width: 12, kind: 'pct' },
      { header: 'Avg order value (₹)', width: 15, kind: 'inr' },
      { header: 'Gateway fee (₹)', width: 14, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Logistics (₹)', width: 13, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Commission (₹)', width: 14, kind: 'inr', total: true, emphasis: 'earning' },
      { header: 'TDS (₹)', width: 11, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'TCS (₹)', width: 11, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Total deductions (₹)', width: 16, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Est. payout (₹)', width: 16, kind: 'inr', total: true, emphasis: 'payout' },
    ];
    if (withBank) {
      columns.push(
        { header: 'Account holder', width: 24, kind: 'text' },
        { header: 'Bank', width: 20, kind: 'text' },
        { header: 'Account number', width: 20, kind: 'text' },
        { header: 'IFSC', width: 14, kind: 'text' },
        { header: 'Account type', width: 13, kind: 'text' },
      );
    }
    const gmv = data.totals.gmv;
    const values = data.sellers.map((s, i) => {
      const t = s.totals;
      const row: CellValue[] = [
        i + 1,
        sellerLabel(s.seller),
        s.seller.user?.name ?? '',
        s.seller.user?.phone ?? '',
        s.seller.user?.email ?? '',
        s.seller.gstNumber?.trim() || 'Not registered',
        STATUS_LABEL[s.seller.status] ?? s.seller.status,
        commissionLabel(s.seller),
        t.orders,
        t.units,
        t.itemSales,
        gmv > 0 ? round2((t.itemSales / gmv) * 100) : 0,
        t.orders > 0 ? round2(t.itemSales / t.orders) : 0,
        t.gatewayFee,
        t.logisticsFee,
        t.commission,
        t.tds,
        t.tcs,
        t.totalDeductions,
        t.netPayout,
      ];
      if (withBank) {
        row.push(
          s.seller.accountHolderName ?? '',
          s.seller.bankName ?? '',
          s.seller.bankAccount ?? '',
          s.seller.ifscCode ?? '',
          s.seller.accountType ?? '',
        );
      }
      return row;
    });
    dataSheet(
      wb,
      withBank ? 'Seller payouts' : 'Sellers',
      C.green,
      `${withBank ? 'Seller payouts' : 'Seller partners'} · ${data.range.label}`,
      this.subtitle(data),
      columns,
      values,
      { freezeColumns: 2, emptyMessage: 'No seller partner had sales in this period.', statusColumns: [7] },
    );
  }

  private buildSellerOrdersSheet(wb: ExcelJS.Workbook, data: AdminDataset, rows: AdminOrderPayout[]) {
    const columns: ColumnSpec[] = [
      { header: 'S.No', width: 7, kind: 'int' },
      { header: 'Store', width: 26, kind: 'text' },
      { header: 'Order ID', width: 38, kind: 'text' },
      { header: 'Short ID', width: 10, kind: 'text' },
      { header: 'Invoice No.', width: 18, kind: 'text' },
      { header: 'Order date', width: 13, kind: 'date' },
      { header: 'Status', width: 12, kind: 'text' },
      { header: 'Units', width: 8, kind: 'int', total: true },
      { header: 'Gross sales (₹)', width: 15, kind: 'inr', total: true },
      { header: 'Gateway fee (₹)', width: 14, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Logistics (₹)', width: 13, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Commission (₹)', width: 14, kind: 'inr', total: true, emphasis: 'earning' },
      { header: 'TDS (₹)', width: 11, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'TCS (₹)', width: 11, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Total deductions (₹)', width: 16, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Est. payout (₹)', width: 16, kind: 'inr', total: true, emphasis: 'payout' },
    ];
    const values: CellValue[][] = [];
    const sorted = rows
      .flatMap((r) => r.parts.map((p) => ({ r, p })))
      .sort((a, b) =>
        sellerLabel(a.p.seller).localeCompare(sellerLabel(b.p.seller)) ||
        a.r.order.createdAt.getTime() - b.r.order.createdAt.getTime(),
      );
    sorted.forEach(({ r, p }, i) => {
      const o = r.order;
      const x = p.payout;
      values.push([
        i + 1,
        sellerLabel(p.seller),
        o.id,
        `#${orderShortId(o.id)}`,
        o.invoiceNumber ?? '',
        toIstWallClock(o.createdAt),
        STATUS_LABEL[o.status] ?? o.status,
        x.units,
        x.itemSales,
        x.gatewayFee,
        x.logisticsFee,
        x.commission,
        x.tds,
        x.tcs,
        x.totalDeductions,
        x.netPayout,
      ]);
    });
    dataSheet(wb, 'Seller orders', C.primary, `Orders by seller partner · ${data.range.label}`, this.subtitle(data), columns, values, {
      freezeColumns: 2,
      emptyMessage: 'No paid orders in this period.',
      statusColumns: [7],
    });
  }

  // ----------------------------------------------------------------- Orders

  private buildOrdersSheet(wb: ExcelJS.Workbook, data: AdminDataset, rows: AdminOrderPayout[]) {
    const columns: ColumnSpec[] = [
      { header: 'S.No', width: 7, kind: 'int' },
      { header: 'Order ID', width: 38, kind: 'text' },
      { header: 'Short ID', width: 10, kind: 'text' },
      { header: 'Invoice No.', width: 18, kind: 'text' },
      { header: 'Order date', width: 13, kind: 'date' },
      { header: 'Order time (IST)', width: 14, kind: 'time' },
      { header: 'Status', width: 12, kind: 'text' },
      { header: 'Buyer', width: 22, kind: 'text' },
      { header: 'Buyer phone', width: 16, kind: 'text' },
      { header: 'Buyer email', width: 28, kind: 'text' },
      { header: 'Ship-to address', width: 44, kind: 'text' },
      { header: 'Seller partner(s)', width: 28, kind: 'text' },
      { header: 'Products', width: 40, kind: 'text' },
      { header: 'From live', width: 9, kind: 'text' },
      { header: 'Units', width: 8, kind: 'int', total: true },
      { header: 'GMV (₹)', width: 14, kind: 'inr', total: true },
      { header: 'Coupon code', width: 14, kind: 'text' },
      { header: 'Coupon discount (₹)', width: 15, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Shipping paid by', width: 13, kind: 'text' },
      { header: 'Buyer delivery charge (₹)', width: 16, kind: 'inr', total: true },
      { header: 'Total paid by buyer (₹)', width: 16, kind: 'inr', total: true },
      { header: 'Actual Delhivery charge (₹)', width: 17, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Gateway fee (₹)', width: 14, kind: 'inr', total: true },
      { header: 'Logistics charged to seller (₹)', width: 17, kind: 'inr', total: true },
      { header: 'Commission (₹)', width: 14, kind: 'inr', total: true, emphasis: 'earning' },
      { header: 'TDS (₹)', width: 11, kind: 'inr', total: true },
      { header: 'TCS (₹)', width: 11, kind: 'inr', total: true },
      { header: 'Seller payout (₹)', width: 16, kind: 'inr', total: true, emphasis: 'payout' },
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
        o.buyer?.user?.phone ?? '',
        o.buyer?.user?.email ?? '',
        (o.shippingAddress ?? '').replace(/\s*\n\s*/g, ', '),
        r.parts.map((p) => sellerLabel(p.seller)).join('; '),
        r.parts
          .flatMap((p) => p.payout.lines)
          .map((l) => `${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ''} × ${l.quantity}`)
          .join('; '),
        o.streamId ? 'Yes' : 'No',
        r.units,
        r.itemSales,
        o.couponCode ?? '',
        r.couponDiscount,
        o.shippingPayer === 'BUYER_PAYS' ? 'Buyer' : 'Seller',
        r.buyerDeliveryFee,
        r.totalPaid,
        r.delhiveryFee,
        r.gatewayFee,
        r.logisticsFee,
        r.commission,
        r.tds,
        r.tcs,
        r.sellerPayout,
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
      emptyMessage: 'No orders match these filters.',
      statusColumns: [7],
    });
  }

  private buildLineItemsSheet(wb: ExcelJS.Workbook, data: AdminDataset, rows: AdminOrderPayout[]) {
    const columns: ColumnSpec[] = [
      { header: 'S.No', width: 7, kind: 'int' },
      { header: 'Order ID', width: 38, kind: 'text' },
      { header: 'Invoice No.', width: 18, kind: 'text' },
      { header: 'Order date', width: 13, kind: 'date' },
      { header: 'Status', width: 12, kind: 'text' },
      { header: 'Seller partner', width: 26, kind: 'text' },
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
      for (const p of r.parts) {
        for (const l of p.payout.lines) {
          values.push([
            n++,
            r.order.id,
            r.order.invoiceNumber ?? '',
            wall,
            STATUS_LABEL[r.order.status] ?? r.order.status,
            sellerLabel(p.seller),
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
    }
    dataSheet(wb, 'Line items', C.royal, `Line items (GST) · ${data.range.label}`, this.subtitle(data), columns, values, {
      freezeColumns: 2,
      emptyMessage: 'No products sold for these filters.',
      statusColumns: [5],
    });
  }

  // ------------------------------------------------------------------ Daily

  private buildDailySheet(wb: ExcelJS.Workbook, data: AdminDataset) {
    const columns: ColumnSpec[] = [
      { header: 'Date', width: 15, kind: 'date' },
      { header: 'Orders', width: 10, kind: 'int', total: true },
      { header: 'Units', width: 10, kind: 'int', total: true },
      { header: 'GMV (₹)', width: 15, kind: 'inr', total: true },
      { header: 'Buyer delivery (₹)', width: 15, kind: 'inr', total: true },
      { header: 'Coupons (₹)', width: 13, kind: 'inr', total: true, emphasis: 'deduction' },
      { header: 'Collected (₹)', width: 15, kind: 'inr', total: true },
      { header: 'Commission (₹)', width: 15, kind: 'inr', total: true, emphasis: 'earning' },
      { header: 'Seller payouts (₹)', width: 16, kind: 'inr', total: true, emphasis: 'payout' },
    ];
    type Agg = { orders: number; units: number; gmv: number; delivery: number; coupons: number; collected: number; commission: number; payouts: number };
    const byDay = new Map<string, Agg>();
    for (const r of data.rows) {
      const key = istYmd(r.order.createdAt);
      const a = byDay.get(key) ?? { orders: 0, units: 0, gmv: 0, delivery: 0, coupons: 0, collected: 0, commission: 0, payouts: 0 };
      a.orders += 1;
      a.units += r.units;
      a.gmv += r.itemSales;
      a.delivery += r.buyerDeliveryFee;
      a.coupons += r.couponDiscount;
      a.collected += r.totalPaid;
      a.commission += r.commission;
      a.payouts += r.sellerPayout;
      byDay.set(key, a);
    }
    const values: CellValue[][] = [];
    const start = data.range.gte.getTime();
    for (let i = 0; i < data.range.days; i++) {
      const key = istYmd(new Date(start + i * 86_400_000));
      const a = byDay.get(key);
      values.push([
        istDateCell(key),
        a?.orders ?? 0,
        a?.units ?? 0,
        round2(a?.gmv ?? 0),
        round2(a?.delivery ?? 0),
        round2(a?.coupons ?? 0),
        round2(a?.collected ?? 0),
        round2(a?.commission ?? 0),
        round2(a?.payouts ?? 0),
      ]);
    }
    dataSheet(wb, 'Daily summary', C.green, `Day-wise summary · ${data.range.label}`, this.subtitle(data), columns, values, {
      freezeColumns: 1,
      emptyMessage: 'No days in this period.',
    });
  }
}
