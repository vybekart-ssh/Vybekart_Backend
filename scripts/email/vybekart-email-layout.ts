/**
 * Shared VybeKart transactional HTML email shell (header, footer, contact block).
 * Use this for all scripted / bulk emails; swap only `bodyHtml` and `whyReceivedHtml`.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface VybeKartMailBranding {
  websiteUrl: string;
  /** Public HTTPS URL for header logo; if empty, header is text-only. */
  logoUrl: string;
  heroImageUrl: string;
  supportEmail: string;
  supportPhone: string;
  companyLegalName: string;
  termsUrl: string;
  privacyUrl: string;
}

/**
 * Reads the same env vars as the alpha-invite script so one .env configures all VybeKart mails.
 */
export function normalizeLogoUrlForEmail(raw: string): string {
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

export function getVybeKartMailBranding(): VybeKartMailBranding {
  return {
    websiteUrl: process.env.ALPHA_WEBSITE_URL || 'https://vybekart.co.in',
    logoUrl: normalizeLogoUrlForEmail(process.env.ALPHA_LOGO_URL?.trim() || ''),
    heroImageUrl: process.env.ALPHA_HERO_IMAGE_URL?.trim() || '',
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
 */
export function headerLogoHtml(b: VybeKartMailBranding): string {
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

export function heroImageHtml(b: VybeKartMailBranding): string {
  const src = b.heroImageUrl ? escapeHtml(b.heroImageUrl) : '';
  if (!src) return '';
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;border-collapse:collapse;">
      <tr>
        <td style="padding:0;">
          <div style="border-radius:14px;overflow:hidden;background:#0B1E5B;">
            <img src="${src}" alt="VybeKart Live Shopping" width="536" style="display:block;width:100%;max-width:536px;height:220px;object-fit:cover;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;"/>
          </div>
        </td>
      </tr>
    </table>
  `.trim();
}

export interface VybeKartMailShellOptions {
  branding: VybeKartMailBranding;
  recipientEmail: string;
  /** Main HTML inside the white card (below header). */
  bodyHtml: string;
  /** Shown in the “Why you received this” block above the contact row. */
  whyReceivedHtml: string;
  /** Optional line(s) after Terms / Privacy (e.g. alpha disclaimer or security note). */
  postLinksHtml?: string;
}

/**
 * Full HTML document: gradient header, logo, standard footer, recipient line.
 */
export function buildVybeKartMailShellHtml(o: VybeKartMailShellOptions): string {
  const b = o.branding;
  const postLinks = o.postLinksHtml
    ? `<p style="margin:12px 0 0;font-size:11px;line-height:1.5;color:#94A3B8;">${o.postLinksHtml}</p>`
    : '';
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
              ${o.bodyHtml}
              <hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0;"/>
              <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#64748B;"><strong style="color:#0B1E5B;">Why you received this</strong><br/>${o.whyReceivedHtml}</p>
              <p style="margin:16px 0 8px;font-size:13px;line-height:1.6;color:#64748B;"><strong style="color:#0B1E5B;">${escapeHtml(b.companyLegalName)}</strong><br/>
                ${b.supportPhone ? `Phone: ${escapeHtml(b.supportPhone)}<br/>` : ''}
                Support: <a href="mailto:${escapeHtml(b.supportEmail)}" style="color:#1565C0;">${escapeHtml(b.supportEmail)}</a>
              </p>
              <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#94A3B8;">
                <a href="${escapeHtml(b.termsUrl)}" style="color:#64748B;">Terms &amp; Conditions</a>
                &nbsp;·&nbsp;
                <a href="${escapeHtml(b.privacyUrl)}" style="color:#64748B;">Privacy Policy</a>
              </p>
              ${postLinks}
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#94A3B8;max-width:600px;">You are receiving this as ${escapeHtml(o.recipientEmail)}. Replies to the automated sender may not be monitored—please use ${escapeHtml(b.supportEmail)}.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
