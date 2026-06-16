import { SellerEmailRecipient } from './seller-email.types';

/** Minimal CSV parser (quoted fields, commas). */
export function parseCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let i = 0;
  let inQuotes = false;
  while (i < content.length) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      field = '';
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    field += c;
    i++;
  }
  row.push(field);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) =>
    h.trim().toLowerCase().replace(/\s+/g, '_'),
  );
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (rows[r][c] ?? '').trim();
    }
    out.push(obj);
  }
  return out;
}

export function normalizeSellerEmailRow(
  r: Record<string, string>,
): SellerEmailRecipient | null {
  const email = (r.email || r['e-mail'] || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  const storeName = (r.store_name || r.store || r.storename || '').trim();
  const contactName = (
    r.contact_name ||
    r.contact ||
    r.name ||
    storeName
  ).trim();
  if (!storeName || !contactName) return null;
  return {
    email,
    storeName,
    contactName,
    phone: (r.phone || r.mobile || '').trim() || undefined,
    city: (r.city || '').trim() || undefined,
  };
}

export function parseSellerEmailRecipients(
  csvContent: string,
): SellerEmailRecipient[] {
  const records = parseCsv(csvContent);
  const out: SellerEmailRecipient[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    const n = normalizeSellerEmailRow(r);
    if (!n) continue;
    if (seen.has(n.email)) continue;
    seen.add(n.email);
    out.push(n);
  }
  return out;
}
