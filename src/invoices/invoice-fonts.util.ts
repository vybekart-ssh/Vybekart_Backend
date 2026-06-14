import * as fs from 'fs';
import * as path from 'path';
import type PDFDocument from 'pdfkit';

const FONT_FILES = {
  regular: 'DejaVuSans.ttf',
  bold: 'DejaVuSans-Bold.ttf',
} as const;

function resolveFontPath(file: string): string {
  const candidates = [
    path.join(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf', file),
    path.join(__dirname, '../../node_modules/dejavu-fonts-ttf/ttf', file),
    path.join(__dirname, '../../../node_modules/dejavu-fonts-ttf/ttf', file),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`Invoice font not found: ${file}`);
  }
  return found;
}

export function registerInvoiceFonts(pdf: InstanceType<typeof PDFDocument>): void {
  pdf.registerFont('InvoiceRegular', resolveFontPath(FONT_FILES.regular));
  pdf.registerFont('InvoiceBold', resolveFontPath(FONT_FILES.bold));
}

export function setInvoiceFont(
  pdf: InstanceType<typeof PDFDocument>,
  bold = false,
): void {
  pdf.font(bold ? 'InvoiceBold' : 'InvoiceRegular');
}
