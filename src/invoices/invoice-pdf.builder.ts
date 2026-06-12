import PDFDocument from 'pdfkit';
import { InvoiceDocumentPayload, InvoicePagePayload } from './invoice.types';
import { formatInrPdf } from './invoice-tax.util';

const PAGE_MARGIN = 36;
const PAGE_WIDTH = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

export async function buildInvoicePdf(
  doc: InvoiceDocumentPayload,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    const chunks: Buffer[] = [];
    pdf.on('data', (c) => chunks.push(c as Buffer));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    doc.pages.forEach((page, idx) => {
      if (idx > 0) pdf.addPage();
      renderPage(pdf, page);
    });

    pdf.end();
  });
}

function renderPage(pdf: InstanceType<typeof PDFDocument>, page: InvoicePagePayload) {
  let y = PAGE_MARGIN;

  pdf
    .fontSize(9)
    .fillColor('#333')
    .text('Tax Invoice/Bill of Supply/Cash Memo', PAGE_MARGIN, y, {
      align: 'center',
      width: CONTENT_WIDTH,
    });
  y += 14;
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
  pdf.fontSize(8).fillColor('#000').font('Helvetica-Bold').text('Sold By :', PAGE_MARGIN, soldByY);
  pdf.font('Helvetica').fontSize(7);
  let sy = soldByY + 12;
  pdf.font('Helvetica-Bold').text(page.soldBy.name, PAGE_MARGIN, sy, { width: colW });
  sy += 10;
  pdf.font('Helvetica');
  for (const line of page.soldBy.lines) {
    pdf.text(line, PAGE_MARGIN, sy, { width: colW });
    sy += 9;
  }
  if (page.soldBy.pan) {
    pdf.text(`PAN No: ${page.soldBy.pan}`, PAGE_MARGIN, sy);
    sy += 9;
  }
  if (page.soldBy.gstin) {
    pdf.text(`GST Registration No: ${page.soldBy.gstin}`, PAGE_MARGIN, sy, { width: colW });
    sy += 9;
  }

  const rightX = PAGE_MARGIN + colW + 16;
  let ay = soldByY;
  pdf.font('Helvetica-Bold').fontSize(8).text('Billing Address :', rightX, ay);
  ay += 12;
  pdf.font('Helvetica').fontSize(7);
  pdf.text(page.billing.name, rightX, ay, { width: colW });
  ay += 9;
  for (const line of page.billing.lines) {
    pdf.text(line, rightX, ay, { width: colW });
    ay += 9;
  }
  if (page.billing.stateCode) {
    pdf.text(`State/UT Code: ${page.billing.stateCode}`, rightX, ay);
    ay += 12;
  }

  pdf.font('Helvetica-Bold').fontSize(8).text('Shipping Address :', rightX, ay);
  ay += 12;
  pdf.font('Helvetica').fontSize(7);
  pdf.text(page.shipping.name, rightX, ay, { width: colW });
  ay += 9;
  for (const line of page.shipping.lines) {
    pdf.text(line, rightX, ay, { width: colW });
    ay += 9;
  }
  if (page.shipping.stateCode) {
    pdf.text(`State/UT Code: ${page.shipping.stateCode}`, rightX, ay);
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
    pdf.text(t, PAGE_MARGIN + colW + 16, y + i * 10, { width: colW, align: 'right' }),
  );
  y += 36;

  y = drawTable(pdf, page, y);
  y += 8;

  pdf.font('Helvetica-Bold').fontSize(8).text('Amount in Words:', PAGE_MARGIN, y);
  y += 10;
  pdf.font('Helvetica').text(page.amountInWords, PAGE_MARGIN, y, { width: CONTENT_WIDTH });
  y += 18;

  pdf.fontSize(7).text('Whether tax is payable under reverse charge - No', PAGE_MARGIN, y);
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
  pdf.text(`Invoice Value: ${page.grandTotal.toFixed(2)}`, PAGE_MARGIN, y);
  y += 9;
  pdf.text(`Mode of Payment: ${page.paymentMode}`, PAGE_MARGIN, y);
  y += 20;

  pdf
    .moveTo(PAGE_MARGIN, y)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, y)
    .strokeColor('#ccc')
    .stroke();
  y += 10;

  const b = page.branding;
  pdf.fontSize(7).fillColor('#444');
  pdf.font('Helvetica-Bold').text(`Regd Office: ${b.companyLegalName}`, PAGE_MARGIN, y, {
    width: CONTENT_WIDTH,
  });
  y += 9;
  pdf.font('Helvetica');
  if (b.registeredOffice) {
    for (const line of b.registeredOffice.split('\n')) {
      pdf.text(line.trim(), PAGE_MARGIN, y, { width: CONTENT_WIDTH });
      y += 8;
    }
  }
  pdf.text(`Email: ${b.supportEmail}`, PAGE_MARGIN, y);
  y += 8;
  pdf.text(b.websiteUrl, PAGE_MARGIN, y);
  y += 12;
  pdf
    .fontSize(6)
    .fillColor('#666')
    .text(
      'This is a system-generated tax invoice and does not require a physical signature.',
      PAGE_MARGIN,
      y,
      { width: CONTENT_WIDTH, align: 'center' },
    );
}

function drawTable(
  pdf: InstanceType<typeof PDFDocument>,
  page: InvoicePagePayload,
  startY: number,
): number {
  const cols = [
    { w: 22, label: 'Sl.\nNo' },
    { w: 130, label: 'Description' },
    { w: 42, label: 'Unit\nPrice' },
    { w: 38, label: 'Discount' },
    { w: 28, label: 'Qty' },
    { w: 42, label: 'Net\nAmount' },
    { w: 32, label: 'Tax\nRate' },
    { w: 32, label: 'Tax\nType' },
    { w: 38, label: 'Tax\nAmount' },
    { w: 42, label: 'Total\nAmount' },
  ];
  let x = PAGE_MARGIN;
  let y = startY;
  const headerH = 28;

  pdf.fontSize(6).font('Helvetica-Bold');
  for (const c of cols) {
    pdf.rect(x, y, c.w, headerH).stroke();
    pdf.text(c.label, x + 2, y + 4, { width: c.w - 4, align: 'center' });
    x += c.w;
  }
  y += headerH;

  pdf.font('Helvetica').fontSize(6);
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
    cols.forEach((c, i) => {
      pdf.rect(x, y, c.w, rowH).stroke();
      pdf.text(cells[i], x + 2, y + 4, { width: c.w - 4 });
      x += c.w;
    });
    y += rowH;
  }

  x = PAGE_MARGIN;
  const totalCols = cols.slice(0, 8).reduce((s, c) => s + c.w, 0);
  const totalW = cols[8].w + cols[9].w;
  pdf.font('Helvetica-Bold');
  pdf.rect(x, y, totalCols, 16).stroke();
  pdf.text('TOTAL:', x + 4, y + 4);
  pdf.rect(x + totalCols, y, cols[8].w, 16).stroke();
  pdf.text(formatInrPdf(page.totalTax), x + totalCols + 2, y + 4, {
    width: cols[8].w - 4,
    align: 'right',
  });
  pdf.rect(x + totalCols + cols[8].w, y, cols[9].w, 16).stroke();
  pdf.text(formatInrPdf(page.grandTotal), x + totalCols + cols[8].w + 2, y + 4, {
    width: cols[9].w - 4,
    align: 'right',
  });
  y += 16;

  return y;
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
