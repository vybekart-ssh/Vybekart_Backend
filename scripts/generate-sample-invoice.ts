import * as fs from 'fs';
import * as path from 'path';
import { buildInvoicePdf } from '../src/invoices/invoice-pdf.builder';
import { buildSampleInvoiceDocument } from '../src/invoices/invoice-sample.util';

async function main() {
  const doc = buildSampleInvoiceDocument();
  const buffer = await buildInvoicePdf(doc);
  const outDir = path.join(__dirname, '..', 'Testing');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'sample-tax-invoice.pdf');
  fs.writeFileSync(outPath, buffer);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath} (${buffer.length} bytes)`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
