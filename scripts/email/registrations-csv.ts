/**
 * Shared parser for registration / alpha-invite CSV files (email + name + type, etc.).
 */

import * as fs from 'fs';
import * as path from 'path';

export function loadBackendDotEnv(): void {
  const backendRoot = path.resolve(__dirname, '../..');
  const envPath = path.join(backendRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

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

export interface RegistrationRow {
  registration_type: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  age_band: string;
  gender: string;
  interests: string;
}

export function normalizeRegistrationRow(
  r: Record<string, string>,
): RegistrationRow | null {
  const email = (r.email || r['e-mail'] || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  return {
    registration_type: (r.registration_type || r.type || 'buyer').toLowerCase(),
    name: (r.name || '').trim(),
    email,
    phone: (r.phone || '').trim(),
    city: (r.city || '').trim(),
    age_band: (r.age_band || r.age || '').trim(),
    gender: (r.gender || '').trim(),
    interests: (r.interests || '').trim(),
  };
}

export function dedupeRegistrationRows(
  records: Record<string, string>[],
): RegistrationRow[] {
  const rows: RegistrationRow[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    const n = normalizeRegistrationRow(r);
    if (!n) continue;
    if (seen.has(n.email)) continue;
    seen.add(n.email);
    rows.push(n);
  }
  return rows;
}
