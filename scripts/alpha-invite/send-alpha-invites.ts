/**
 * One-off bulk sender: reads registrations CSV, sends personalized VybeKart Android alpha invite via Resend.
 *
 * Usage (from repo root):
 *   REGISTRATIONS_CSV=./scripts/alpha-invite/registrations.csv npx ts-node --transpile-only scripts/alpha-invite/send-alpha-invites.ts
 *
 * Or set vars in .env (same folder as backend .env is auto-loaded if present).
 *
 * DRY_RUN=true — log only, no API calls.
 */

import * as fs from 'fs';
import * as path from 'path';

function loadEnvFromFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
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

const backendRoot = path.resolve(__dirname, '../..');
loadEnvFromFile(path.join(backendRoot, '.env'));

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseCsv(content: string): Record<string, string>[] {
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

function firstName(full: string): string {
  const t = (full || '').trim();
  if (!t) return 'there';
  return t.split(/\s+/)[0] || 'there';
}

interface Row {
  registration_type: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  age_band: string;
  gender: string;
  interests: string;
}

function normalizeRow(r: Record<string, string>): Row | null {
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

interface Branding {
  driveUrl: string;
  websiteUrl: string;
  /** Public HTTPS URL for header logo; if empty, header is text-only. */
  logoUrl: string;
  replyTo: string;
  supportEmail: string;
  supportPhone: string;
  companyLegalName: string;
  termsUrl: string;
  privacyUrl: string;
}

/**
 * Normalize logo URL for email clients. Optional `?v=1` helps Gmail’s image proxy
 * refetch when the file was updated (disable with ALPHA_LOGO_NO_CACHE_BUST=true).
 */
function normalizeAlphaLogoUrl(raw: string): string {
  const u = raw.trim();
  if (!u) return '';
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return u;
    if (
      parsed.search === '' &&
      String(process.env.ALPHA_LOGO_NO_CACHE_BUST || '').toLowerCase() !==
        'true'
    ) {
      parsed.searchParams.set('v', '1');
    }
    return parsed.href;
  } catch {
    return u;
  }
}

function getBranding(): Branding {
  return {
    driveUrl:
      process.env.ALPHA_DRIVE_URL ||
      'https://drive.google.com/drive/folders/1DUobwSc-sBDoijr5RA6OpH_T5oXS9tPp?usp=sharing',
    websiteUrl: process.env.ALPHA_WEBSITE_URL || 'https://vybekart.co.in',
    logoUrl: normalizeAlphaLogoUrl(process.env.ALPHA_LOGO_URL?.trim() || ''),
    replyTo: process.env.ALPHA_REPLY_TO || 'support@vybekart.co.in',
    supportEmail: process.env.ALPHA_SUPPORT_EMAIL || 'support@vybekart.co.in',
    supportPhone: process.env.ALPHA_SUPPORT_PHONE || '',
    companyLegalName:
      process.env.ALPHA_COMPANY_LEGAL_NAME || 'VybeKart',
    termsUrl: process.env.ALPHA_TERMS_URL || 'https://vybekart.co.in/terms',
    privacyUrl: process.env.ALPHA_PRIVACY_URL || 'https://vybekart.co.in/privacy',
  };
}

/**
 * Table-wrapped, fixed-size logo for Gmail / Outlook / Apple Mail.
 * Linked to the site so the header still works if images are blocked.
 */
function headerLogoHtml(b: Branding): string {
  if (!b.logoUrl) return '';
  const src = escapeHtml(b.logoUrl);
  const home = escapeHtml(b.websiteUrl);
  const w = 96;
  const h = 96;
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 12px auto;line-height:0;border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;">
<tr><td align="center" style="padding:0;line-height:0;font-size:0;">
<a href="${home}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;border:0;display:inline-block;">
<img src="${src}" width="${w}" height="${h}" border="0" alt="VybeKart" style="display:block;width:${w}px;height:${h}px;max-width:${w}px;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;border-radius:14px;line-height:0;font-size:0;"/>
</a>
</td></tr>
</table>`;
}

/** Warn if the logo URL does not return an image (wrong bucket, 403, HTML error page, etc.). */
async function verifyLogoUrlIfSet(url: string): Promise<void> {
  if (!url) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { Accept: 'image/*,*/*;q=0.8' },
    });
    clearTimeout(timer);
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!res.ok) {
      console.warn(
        `ALPHA_LOGO_URL returned HTTP ${res.status} — images will likely be broken in email. Fix Storage policy or URL.`,
      );
      return;
    }
    if (!ct.toLowerCase().startsWith('image/')) {
      console.warn(
        `ALPHA_LOGO_URL Content-Type is "${ct || 'missing'}" — expected image/png or image/jpeg. Re-upload the file or set correct type in Supabase.`,
      );
      return;
    }
    console.log(`ALPHA_LOGO_URL OK (${ct})`);
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `Could not verify ALPHA_LOGO_URL (${msg}). If the logo is missing in inbox, confirm the bucket is public and the object path matches.`,
    );
  }
}

function personalizedIntro(row: Row, b: Branding): string {
  const fn = firstName(row.name);
  const role =
    row.registration_type === 'seller'
      ? 'as an early seller partner'
      : 'as an early shopper';
  let s = `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">Dear ${escapeHtml(fn)},</p>`;
  s += `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">Thank you for joining VybeKart ${role} through our website at <a href="${escapeHtml(b.websiteUrl)}" style="color:#1565C0;">vybekart.co.in</a>. We are opening access to the <strong>Android alpha</strong> so you can explore live shopping and selling in one place.</p>`;
  if (row.city || row.interests) {
    const bits: string[] = [];
    if (row.city)
      bits.push(`we noted you are in the <strong>${escapeHtml(row.city)}</strong> area`);
    if (row.interests)
      bits.push(
        `your interests include <strong>${escapeHtml(row.interests)}</strong>`,
      );
    if (bits.length)
      s += `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">Where it helps us serve you better, ${bits.join(' and ')}—we will keep improving discovery and recommendations as the platform grows.</p>`;
  }
  return s;
}

function buildHtml(row: Row, b: Branding): string {
  const intro = personalizedIntro(row, b);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F0F4F8;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#1E88E5 0%,#1565C0 100%);padding:28px 32px;text-align:center;">
              ${headerLogoHtml(b)}
              <div style="color:#FFFFFF;font-size:22px;font-weight:700;letter-spacing:0.04em;">VYBEKART</div>
              <div style="color:#00C6FF;font-size:15px;font-weight:600;margin-top:6px;">Just Vybe it !</div>
              <div style="color:rgba(255,255,255,0.92);font-size:14px;margin-top:8px;line-height:1.4;">Shop live. Sell live. All in one place.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              ${intro}
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">This build is an <strong>alpha</strong>: you may notice rough edges. We would be grateful if you use the <strong>Feedback</strong> option inside the app (Profile / Help area) to tell us what works, what does not, and what you would like next. Your input directly shapes the product.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;">
                <tr>
                  <td style="border-radius:8px;background:#1E88E5;">
                    <a href="${escapeHtml(b.driveUrl)}" style="display:inline-block;padding:14px 28px;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:600;">Download Android app (Google Drive)</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#64748B;">Prefer the web experience? Visit <a href="${escapeHtml(b.websiteUrl)}" style="color:#1565C0;font-weight:600;">vybekart.co.in</a> anytime.</p>
              <p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#64748B;">If you know others who would benefit from live shopping or selling, feel free to share the website or this email—there is no obligation; we simply welcome thoughtful early adopters who can help us refine the Vybe.</p>
              <hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0;"/>
              <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#64748B;"><strong style="color:#0B1E5B;">Why you received this</strong><br/>You submitted an early-access or pre-registration form on vybekart.co.in. This message is a one-time product update with download instructions.</p>
              <p style="margin:16px 0 8px;font-size:13px;line-height:1.6;color:#64748B;"><strong style="color:#0B1E5B;">${escapeHtml(b.companyLegalName)}</strong><br/>
                ${b.supportPhone ? `Phone: ${escapeHtml(b.supportPhone)}<br/>` : ''}
                Support: <a href="mailto:${escapeHtml(b.supportEmail)}" style="color:#1565C0;">${escapeHtml(b.supportEmail)}</a>
              </p>
              <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#94A3B8;">
                <a href="${escapeHtml(b.termsUrl)}" style="color:#64748B;">Terms &amp; Conditions</a>
                &nbsp;·&nbsp;
                <a href="${escapeHtml(b.privacyUrl)}" style="color:#64748B;">Privacy Policy</a>
              </p>
              <p style="margin:12px 0 0;font-size:11px;line-height:1.5;color:#94A3B8;">Alpha software is provided as-is. Features and availability may change. By using the app you agree to our Terms and acknowledge our Privacy Policy.</p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#94A3B8;max-width:600px;">You are receiving this as ${escapeHtml(row.email)}. Replies to the automated sender may not be monitored—please use ${escapeHtml(b.supportEmail)}.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildText(row: Row, b: Branding): string {
  const fn = firstName(row.name);
  const lines = [
    `Dear ${fn},`,
    '',
    `Thank you for joining VybeKart (${row.registration_type === 'seller' ? 'seller partner' : 'shopper'}) via vybekart.co.in.`,
    '',
    'We are inviting you to try the VybeKart Android alpha.',
    '',
    `Download (Google Drive): ${b.driveUrl}`,
    `Website: ${b.websiteUrl}`,
    '',
    'This is an alpha build. Please use the in-app Feedback option to share what works and what we should improve.',
    '',
    'If you know others who would benefit from live shopping or selling, you are welcome to share the website or this message.',
    '',
    'Why you received this: you submitted an early-access / pre-registration form on vybekart.co.in.',
    '',
    `${b.companyLegalName}`,
    b.supportPhone ? `Phone: ${b.supportPhone}` : '',
    `Support: ${b.supportEmail}`,
    '',
    `Terms: ${b.termsUrl}`,
    `Privacy: ${b.privacyUrl}`,
    '',
    `Recipient: ${row.email}`,
  ];
  return lines.filter(Boolean).join('\n');
}

function subjectFor(row: Row): string {
  const fn = firstName(row.name);
  if (fn === 'there') return 'Your VybeKart Android alpha is ready';
  return `${fn}, your VybeKart Android alpha is ready`;
}

async function sendViaResend(
  apiKey: string,
  opts: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    replyTo: string;
  },
): Promise<string> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: opts.from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      reply_to: opts.replyTo,
    }),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Resend API ${res.status}: ${bodyText}`);
  }
  try {
    const j = JSON.parse(bodyText) as { id?: string };
    return j.id || bodyText;
  } catch {
    return bodyText;
  }
}

async function main(): Promise<void> {
  const rawCsv =
    process.env.REGISTRATIONS_CSV?.trim() ||
    path.join(__dirname, 'registrations.csv');
  const csvPath = path.isAbsolute(rawCsv)
    ? rawCsv
    : path.join(process.cwd(), rawCsv);
  const dryRun =
    String(process.env.DRY_RUN || '').toLowerCase() === 'true' ||
    process.argv.includes('--dry-run');

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const mailFrom =
    process.env.MAIL_FROM?.trim() || 'VybeKart <noreply@vybekart.co.in>';

  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found:', csvPath);
    console.error('Set REGISTRATIONS_CSV or place registrations.csv next to this script.');
    process.exit(1);
  }

  if (!dryRun && !apiKey) {
    console.error('Missing RESEND_API_KEY in environment or .env');
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, 'utf8');
  const records = parseCsv(raw);
  const branding = getBranding();
  if (!branding.logoUrl) {
    console.warn(
      'ALPHA_LOGO_URL is not set — email header will be text-only. Add it to .env (see scripts/alpha-invite/config.example.env).',
    );
  }

  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    const n = normalizeRow(r);
    if (!n) continue;
    if (seen.has(n.email)) continue;
    seen.add(n.email);
    rows.push(n);
  }

  console.log(`Recipients (deduped): ${rows.length}`);
  if (rows.length === 0) {
    process.exit(0);
  }

  await verifyLogoUrlIfSet(branding.logoUrl);

  const delayMs = Math.max(
    0,
    parseInt(process.env.ALPHA_SEND_DELAY_MS || '700', 10) || 700,
  );
  const logPath =
    process.env.ALPHA_SEND_LOG ||
    path.join(__dirname, `alpha-send-log-${Date.now()}.jsonl`);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const html = buildHtml(row, branding);
    const text = buildText(row, branding);
    const subject = subjectFor(row);

    if (dryRun) {
      console.log(`[DRY_RUN] ${row.email} | ${subject}`);
      if (i === 0) {
        console.log('--- text preview ---\n', text.slice(0, 800), '\n---');
      }
      continue;
    }

    try {
      const id = await sendViaResend(apiKey!, {
        from: mailFrom,
        to: row.email,
        subject,
        html,
        text,
        replyTo: branding.replyTo,
      });
      const line = JSON.stringify({
        ok: true,
        email: row.email,
        resendId: id,
        at: new Date().toISOString(),
      });
      fs.appendFileSync(logPath, line + '\n');
      console.log(`OK ${i + 1}/${rows.length} ${row.email} ${id}`);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      fs.appendFileSync(
        logPath,
        JSON.stringify({
          ok: false,
          email: row.email,
          error: err,
          at: new Date().toISOString(),
        }) + '\n',
      );
      console.error(`FAIL ${row.email}: ${err}`);
    }

    if (i < rows.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (!dryRun) console.log('Log file:', logPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
