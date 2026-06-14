import PDFDocument from 'pdfkit';
import { InvoiceDocumentPayload, InvoicePagePayload } from './invoice.types';
import { formatInrPdf } from './invoice-tax.util';
import { registerInvoiceFonts, setInvoiceFont } from './invoice-fonts.util';
import {
  drawBrandFooter,
  drawBrandHeader,
  resolveInvoiceLogoBuffer,
} from './invoice-logo.util';

const PAGE_MARGIN = 36;
const PAGE_WIDTH = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

type TableCol = {
  w: number;
  label: string;
  align?: 'left' | 'right' | 'center';
  numeric?: boolean;
};

const TABLE_COLS: TableCol[] = [
  { w: 20, label: 'Sl.\nNo', align: 'center' },
  { w: 128, label: 'Description' },
  { w: 50, label: 'Unit\nPrice', align: 'right', numeric: true },
  { w: 42, label: 'Discount', align: 'right', numeric: true },
  { w: 26, label: 'Qty', align: 'center' },
  { w: 50, label: 'Net\nAmount', align: 'right', numeric: true },
  { w: 30, label: 'Tax\nRate', align: 'center' },
  { w: 30, label: 'Tax\nType', align: 'center' },
  { w: 52, label: 'Tax\nAmount', align: 'right', numeric: true },
  { w: 55, label: 'Total\nAmount', align: 'right', numeric: true },
];

export async function buildInvoicePdf(
  doc: InvoiceDocumentPayload,
): Promise<Buffer> {
  const logoBuffer = await resolveInvoiceLogoBuffer();

  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    const chunks: Buffer[] = [];
    pdf.on('data', (c) => chunks.push(c as Buffer));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    registerInvoiceFonts(pdf);
    setInvoiceFont(pdf, false);

    doc.pages.forEach((page, idx) => {
      if (idx > 0) pdf.addPage();
      renderPage(pdf, page, logoBuffer);
    });

    pdf.end();
  });
}

function renderPage(
  pdf: InstanceType<typeof PDFDocument>,
  page: InvoicePagePayload,
  logoBuffer: Buffer | null,
) {
  let y = drawBrandHeader(pdf, page.branding, logoBuffer, PAGE_MARGIN);

  setInvoiceFont(pdf, true);
  pdf
    .fontSize(9)
    .fillColor('#333')
    .text('Tax Invoice/Bill of Supply/Cash Memo', PAGE_MARGIN, y, {
      align: 'center',
      width: CONTENT_WIDTH,
    });
  y += 14;
  setInvoiceFont(pdf, false);
  pdf.fontSize(8).text('(Original for Recipient)', PAGE_MARGIN, y, {
    align: 'center',
    width: CONTENT_WIDTH,
  });
  y += 12;
  pdf
    .fontSize(7)
    .fillColor('#555')
    .text(
      'Please note that this invoice is not a demand for payment',
      PAGE_MARGIN,
      y,
      { align: 'center', width: CONTENT_WIDTH },
    );
  y += 10;
  pdf.text(`Page ${page.pageNo} of ${page.pageTotal}`, PAGE_MARGIN, y, {
    align: 'right',
    width: CONTENT_WIDTH,
  });
  y += 16;

  const colW = CONTENT_WIDTH / 2 - 8;
  const soldByY = y;
  setInvoiceFont(pdf, true);
  pdf.fontSize(8).fillColor('#000').text('Sold By :', PAGE_MARGIN, soldByY);
  setInvoiceFont(pdf, false);
  pdf.fontSize(7);
  let sy = soldByY + 12;
  setInvoiceFont(pdf, true);
  pdf.text(page.soldBy.name, PAGE_MARGIN, sy, { width: colW });
  sy += 10;
  setInvoiceFont(pdf, false);
  for (const line of page.soldBy.lines) {
    pdf.text(line, PAGE_MARGIN, sy, { width: colW });
    sy += 9;
  }
  if (page.soldBy.pan) {
    pdf.text(`PAN No: ${page.soldBy.pan}`, PAGE_MARGIN, sy, { width: colW });
    sy += 9;
  }
  if (page.soldBy.gstin) {
    pdf.text(`GST Registration No: ${page.soldBy.gstin}`, PAGE_MARGIN, sy, {
      width: colW,
    });
    sy += 9;
  }

  const rightX = PAGE_MARGIN + colW + 16;
  let ay = soldByY;
  setInvoiceFont(pdf, true);
  pdf.fontSize(8).text('Billing Address :', rightX, ay);
  ay += 12;
  setInvoiceFont(pdf, false);
  pdf.fontSize(7);
  pdf.text(page.billing.name, rightX, ay, { width: colW });
  ay += 9;
  for (const line of page.billing.lines) {
    pdf.text(line, rightX, ay, { width: colW });
    ay += 9;
  }
  if (page.billing.stateCode) {
    pdf.text(`State/UT Code: ${page.billing.stateCode}`, rightX, ay, {
      width: colW,
    });
    ay += 12;
  }

  setInvoiceFont(pdf, true);
  pdf.fontSize(8).text('Shipping Address :', rightX, ay);
  ay += 12;
  setInvoiceFont(pdf, false);
  pdf.fontSize(7);
  pdf.text(page.shipping.name, rightX, ay, { width: colW });
  ay += 9;
  for (const line of page.shipping.lines) {
    pdf.text(line, rightX, ay, { width: colW });
    ay += 9;
  }
  if (page.shipping.stateCode) {
    pdf.text(`State/UT Code: ${page.shipping.stateCode}`, rightX, ay, {
      width: colW,
    });
    ay += 9;
  }

  y = Math.max(sy, ay) + 14;
  pdf.fontSize(7).text(`Place of supply: ${page.placeOfSupply}`, PAGE_MARGIN, y);
  y += 10;
  pdf.text(`Place of delivery: ${page.placeOfDelivery}`, PAGE_MARGIN, y);
  y += 16;

  const metaLeft = [
    `Order Number: ${page.orderNumber}`,
    `Order Date: ${formatDateDot(page.orderDate)}`,
    `Invoice Date : ${formatDateDot(page.invoiceDate)}`,
  ];
  const metaRight = [
    `Invoice Number : ${page.invoiceNumber}`,
    `Invoice Details : ${page.invoiceDetails}`,
  ];
  if (page.isReplacement && page.originalOrderRef) {
    metaLeft.push(`Original Order: ${page.originalOrderRef}`);
  }
  metaLeft.forEach((t, i) => pdf.text(t, PAGE_MARGIN, y + i * 10));
  metaRight.forEach((t, i) =>
    pdf.text(t, PAGE_MARGIN + colW + 16, y + i * 10, {
      width: colW,
      align: 'right',
    }),
  );
  y += 36;

  y = drawTable(pdf, page, y);
  y += 8;

  setInvoiceFont(pdf, true);
  pdf.fontSize(8).text('Amount in Words:', PAGE_MARGIN, y);
  y += 10;
  setInvoiceFont(pdf, false);
  pdf.text(page.amountInWords, PAGE_MARGIN, y, { width: CONTENT_WIDTH });
  y += 18;

  pdf.fontSize(7).text(
    'Whether tax is payable under reverse charge - No',
    PAGE_MARGIN,
    y,
  );
  y += 14;

  if (page.paymentTransactionId) {
    pdf.text(`Payment Transaction ID: ${page.paymentTransactionId}`, PAGE_MARGIN, y);
    y += 9;
  }
  if (page.paymentDateTime) {
    pdf.text(
      `Date & Time: ${formatPaymentDt(page.paymentDateTime)}`,
      PAGE_MARGIN,
      y,
    );
    y += 9;
  }
  pdf.text(`Invoice Value: ${formatInrPdf(page.grandTotal)}`, PAGE_MARGIN, y);
  y += 9;
  pdf.text(`Mode of Payment: ${page.paymentMode}`, PAGE_MARGIN, y);
  y += 20;

  drawBrandFooter(pdf, page.branding, y);
}

function drawTable(
  pdf: InstanceType<typeof PDFDocument>,
  page: InvoicePagePayload,
  startY: number,
): number {
  let x = PAGE_MARGIN;
  let y = startY;
  const headerH = 28;

  setInvoiceFont(pdf, true);
  pdf.fontSize(6);
  for (const c of TABLE_COLS) {
    pdf.rect(x, y, c.w, headerH).stroke();
    pdf.text(c.label, x + 2, y + 4, {
      width: c.w - 4,
      align: c.align ?? 'left',
      lineGap: 0,
    });
    x += c.w;
  }
  y += headerH;

  setInvoiceFont(pdf, false);
  pdf.fontSize(6);
  for (const item of page.lineItems) {
    const taxRows = item.taxes.length || 1;
    const rowH = Math.max(22, taxRows * 10 + 8);
    x = PAGE_MARGIN;
    const cells: string[] = [
      String(item.slNo),
      item.description + (item.hsnCode ? `\nHSN:${item.hsnCode}` : ''),
      formatInrPdf(item.unitPriceIncl),
      formatInrPdf(item.discount),
      String(item.quantity),
      formatInrPdf(item.netAmount),
      item.taxes.map((t) => `${t.ratePercent}%`).join('\n') || '-',
      item.taxes.map((t) => t.type).join('\n') || '-',
      item.taxes.map((t) => formatInrPdf(t.amount)).join('\n') || '-',
      formatInrPdf(item.totalAmount),
    ];
    TABLE_COLS.forEach((c, i) => {
      pdf.rect(x, y, c.w, rowH).stroke();
      drawCell(pdf, cells[i], x, y, c.w, rowH, c);
      x += c.w;
    });
    y += rowH;
  }

  const totalLabelW = TABLE_COLS.slice(0, 8).reduce((s, c) => s + c.w, 0);
  const taxCol = TABLE_COLS[8];
  const totalCol = TABLE_COLS[9];
  const totalRowH = 18;
  x = PAGE_MARGIN;

  setInvoiceFont(pdf, true);
  pdf.rect(x, y, totalLabelW, totalRowH).stroke();
  pdf.text('TOTAL:', x + 4, y + 5, { width: totalLabelW - 8 });

  pdf.rect(x + totalLabelW, y, taxCol.w, totalRowH).stroke();
  drawCell(
    pdf,
    formatInrPdf(page.totalTax),
    x + totalLabelW,
    y,
    taxCol.w,
    totalRowH,
    taxCol,
  );

  pdf.rect(x + totalLabelW + taxCol.w, y, totalCol.w, totalRowH).stroke();
  drawCell(
    pdf,
    formatInrPdf(page.grandTotal),
    x + totalLabelW + taxCol.w,
    y,
    totalCol.w,
    totalRowH,
    totalCol,
  );
  y += totalRowH;

  return y;
}

function drawCell(
  pdf: InstanceType<typeof PDFDocument>,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  col: TableCol,
): void {
  const padX = 3;
  const fontSize = col.numeric ? 5.5 : 6;
  pdf.fontSize(fontSize);
  setInvoiceFont(pdf, false);
  pdf.text(text, x + padX, y + 4, {
    width: w - padX * 2,
    height: h - 6,
    align: col.align ?? 'left',
    lineGap: 0,
  });
}

function formatDateDot(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function formatPaymentDt(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy}, ${hh}:${min}:${sec} hrs`;
}
