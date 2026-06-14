import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import type PDFDocument from 'pdfkit';
import { setInvoiceFont } from './invoice-fonts.util';
import type { InvoiceBranding } from './invoice-branding.types';

const LOGO_RENDER_HEIGHT = 96;
const BRAND_BLUE = '#1565C0';

function resolveBrandAsset(fileName: string): string {
  const rel = path.join('assets', 'brand', fileName);
  const candidates = [
    path.join(process.cwd(), rel),
    path.join(process.cwd(), 'dist', rel),
    path.join(__dirname, '..', rel),
    path.join(__dirname, '../../..', rel),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`Brand asset not found: ${fileName}`);
  }
  return found;
}

async function rasterizeSvg(svg: Buffer): Promise<Buffer> {
  return sharp(svg, { density: 300 })
    .resize({ height: LOGO_RENDER_HEIGHT })
    .png()
    .toBuffer();
}

/** Prefer bundled SVG logo; fall back to bundled PNG. */
export async function resolveInvoiceLogoBuffer(): Promise<Buffer | null> {
  try {
    const svgPath = resolveBrandAsset('vybekart_logo.svg');
    return await rasterizeSvg(fs.readFileSync(svgPath));
  } catch {
    try {
      const pngPath = resolveBrandAsset('vybekart-logo.png');
      return await sharp(fs.readFileSync(pngPath))
        .resize({ height: LOGO_RENDER_HEIGHT })
        .png()
        .toBuffer();
    } catch {
      return null;
    }
  }
}

/** Logo + trade name + GSTIN at top of each invoice page. */
export function drawBrandHeader(
  pdf: InstanceType<typeof PDFDocument>,
  branding: InvoiceBranding,
  logoBuffer: Buffer | null,
  startY: number,
): number {
  const left = 36;
  let y = startY;
  const logoW = 40;
  const logoH = 44;

  if (logoBuffer) {
    try {
      pdf.image(logoBuffer, left, y, { fit: [logoW, logoH] });
    } catch {
      // Skip broken image buffer.
    }
  }

  const textX = left + logoW + 12;
  const textW = 523.28 - logoW - 12;

  setInvoiceFont(pdf, true);
  pdf.fontSize(15).fillColor(BRAND_BLUE).text(branding.platformBrand, textX, y + 2, {
    width: textW,
  });
  setInvoiceFont(pdf, false);
  pdf.fontSize(7).fillColor('#666').text(
    `Trade name: ${branding.tradeName}`,
    textX,
    y + 20,
    { width: textW },
  );
  pdf.fontSize(8).fillColor('#444').text(`GSTIN: ${branding.gstin}`, textX, y + 32, {
    width: textW,
  });

  y += logoH + 8;
  pdf
    .moveTo(left, y)
    .lineTo(left + 523.28, y)
    .strokeColor('#d0d7de')
    .lineWidth(0.75)
    .stroke();
  return y + 12;
}

export function drawBrandFooter(
  pdf: InstanceType<typeof PDFDocument>,
  _branding: InvoiceBranding,
  startY: number,
): number {
  let y = startY;
  const left = 36;

  pdf
    .moveTo(left, y)
    .lineTo(left + 523.28, y)
    .strokeColor('#ccc')
    .stroke();
  y += 10;

  setInvoiceFont(pdf, false);
  pdf
    .fontSize(6)
    .fillColor('#666')
    .text(
      'This is a system-generated tax invoice and does not require a physical signature.',
      left,
      y,
      { width: 523.28, align: 'center' },
    );
  return y + 12;
}
