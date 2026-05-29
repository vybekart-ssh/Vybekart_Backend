import { ConfigService } from '@nestjs/config';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface VybeKartMailBranding {
  websiteUrl: string;
  logoUrl: string;
  heroImageUrl: string;
  supportEmail: string;
  companyLegalName: string;
  termsUrl: string;
  privacyUrl: string;
}

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

export function getVybeKartMailBranding(config: ConfigService): VybeKartMailBranding {
  return {
    websiteUrl:
      config.get<string>('ALPHA_WEBSITE_URL')?.trim() || 'https://vybekart.co.in',
    logoUrl: normalizeLogoUrlForEmail(
      config.get<string>('ALPHA_LOGO_URL')?.trim() || '',
    ),
    heroImageUrl: config.get<string>('ALPHA_HERO_IMAGE_URL')?.trim() || '',
    supportEmail:
      config.get<string>('SUPPORT_EMAIL')?.trim() || 'support@vybekart.co.in',
    companyLegalName:
      config.get<string>('ALPHA_COMPANY_LEGAL_NAME')?.trim() || 'VybeKart',
    termsUrl:
      config.get<string>('ALPHA_TERMS_URL')?.trim() ||
      'https://vybekart.co.in/terms',
    privacyUrl:
      config.get<string>('ALPHA_PRIVACY_URL')?.trim() ||
      'https://vybekart.co.in/privacy',
  };
}

/** Compact logo for the hero top bar (email-client safe). */
function headerLogoMarkHtml(b: VybeKartMailBranding): string {
  const home = escapeHtml(b.websiteUrl);
  if (b.logoUrl) {
    const src = escapeHtml(b.logoUrl);
    return `<a href="${home}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;border:0;display:inline-block;line-height:0;">
<img src="${src}" width="52" height="52" border="0" alt="VybeKart" style="display:block;width:52px;height:52px;border:0;border-radius:14px;box-shadow:0 4px 14px rgba(0,0,0,0.18);"/>
</a>`;
  }
  return `<a href="${home}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:inline-block;width:52px;height:52px;border-radius:14px;background:linear-gradient(145deg,#00C6FF,#003BFF);box-shadow:0 4px 14px rgba(0,0,0,0.2);text-align:center;line-height:52px;font-size:22px;font-weight:800;color:#FFFFFF;letter-spacing:-0.02em;">V</a>`;
}

/** Right-side hero visual — optional image URL or branded live-shopping orb. */
function headerHeroVisualHtml(b: VybeKartMailBranding): string {
  if (b.heroImageUrl) {
    const src = escapeHtml(b.heroImageUrl);
    return `<img src="${src}" width="140" height="140" alt="" style="display:block;width:140px;height:140px;object-fit:contain;border:0;"/>`;
  }
  return `<div style="width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,0.14);border:2px solid rgba(255,255,255,0.28);text-align:center;line-height:120px;font-size:56px;margin:0 auto;">🛍️</div>`;
}

/**
 * Swiggy-inspired hero: bold gradient, pattern, logo + wordmark, tagline, dynamic headline.
 */
export function buildVybeKartHeroHeaderHtml(params: {
  branding: VybeKartMailBranding;
  headerBadge: string;
  headerTitle: string;
  headerSubtitle?: string;
}): string {
  const b = params.branding;
  const home = escapeHtml(b.websiteUrl);
  const subtitle = params.headerSubtitle
    ? `<p style="margin:10px 0 0;font-size:14px;line-height:1.45;color:rgba(255,255,255,0.88);font-weight:500;">${escapeHtml(params.headerSubtitle)}</p>`
    : '';

  return `<!-- VybeKart hero header -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
  <tr>
    <td style="padding:0;background:#FF5722;background-image:linear-gradient(135deg,#FF8A50 0%,#FF5722 38%,#F4511E 72%,#E64A19 100%);">
      <!--[if gte mso 9]>
      <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:200px;">
        <v:fill type="gradient" color="#FF8A50" color2="#E64A19" angle="135"/>
        <v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text:true">
      <![endif]-->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background-image:url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22 viewBox=%220 0 40 40%22%3E%3Ccircle cx=%2220%22 cy=%2220%22 r=%221.8%22 fill=%22%23ffffff%22 fill-opacity=%220.12%22/%3E%3C/svg%3E');background-repeat:repeat;">
        <!-- Brand bar -->
        <tr>
          <td style="padding:20px 24px 0 24px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td align="left" valign="middle" style="padding:0;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td valign="middle" style="padding:0 12px 0 0;line-height:0;">${headerLogoMarkHtml(b)}</td>
                      <td valign="middle" style="padding:0;">
                        <a href="${home}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">
                          <span style="font-size:24px;font-weight:800;color:#FFFFFF;letter-spacing:-0.02em;line-height:1.1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">VybeKart</span>
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
                <td align="right" valign="middle" style="padding:0;">
                  <span style="display:inline-block;padding:8px 14px;border-radius:999px;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.35);font-size:13px;font-weight:700;color:#FFFFFF;letter-spacing:0.02em;font-style:italic;white-space:nowrap;">Just Vybe It!</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Headline row -->
        <tr>
          <td style="padding:18px 24px 28px 24px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td width="58%" valign="bottom" style="padding:0 12px 0 0;">
                  <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.82);">${escapeHtml(params.headerBadge)}</p>
                  <h1 style="margin:0;font-size:28px;line-height:1.15;font-weight:800;color:#FFFFFF;letter-spacing:-0.03em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(params.headerTitle)}</h1>
                  ${subtitle}
                </td>
                <td width="42%" align="right" valign="bottom" style="padding:0;">
                  ${headerHeroVisualHtml(b)}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <!--[if gte mso 9]></v:textbox></v:rect><![endif]-->
    </td>
  </tr>
</table>`;
}

export function buildVybeKartMailShellHtml(params: {
  branding: VybeKartMailBranding;
  recipientEmail: string;
  headerBadge: string;
  headerTitle: string;
  headerSubtitle?: string;
  bodyHtml: string;
  whyReceivedHtml: string;
}): string {
  const b = params.branding;
  const hero = buildVybeKartHeroHeaderHtml({
    branding: b,
    headerBadge: params.headerBadge,
    headerTitle: params.headerTitle,
    headerSubtitle: params.headerSubtitle,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <title>${escapeHtml(params.headerTitle)}</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F1F5F9;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(15,23,42,0.12);">
        <tr><td style="padding:0;line-height:0;font-size:0;">
          ${hero}
        </td></tr>
        <tr>
          <td style="padding:32px 28px 28px 28px;">
            ${params.bodyHtml}
            <hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0 24px;"/>
            <p style="margin:0 0 10px;font-size:13px;line-height:1.65;color:#64748B;">
              <strong style="color:#0B1E5B;font-size:13px;">Why you received this</strong><br/>
              ${params.whyReceivedHtml}
            </p>
            <p style="margin:16px 0 0;font-size:13px;line-height:1.65;color:#64748B;">
              <strong style="color:#0B1E5B;">${escapeHtml(b.companyLegalName)}</strong><br/>
              Support: <a href="mailto:${escapeHtml(b.supportEmail)}" style="color:#FF5722;font-weight:600;text-decoration:none;">${escapeHtml(b.supportEmail)}</a>
              &nbsp;·&nbsp;
              <a href="${escapeHtml(b.websiteUrl)}" style="color:#1565C0;text-decoration:none;">vybekart.co.in</a>
            </p>
            <p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:#94A3B8;">
              <a href="${escapeHtml(b.termsUrl)}" style="color:#64748B;text-decoration:underline;">Terms &amp; Conditions</a>
              &nbsp;·&nbsp;
              <a href="${escapeHtml(b.privacyUrl)}" style="color:#64748B;text-decoration:underline;">Privacy Policy</a>
            </p>
            <p style="margin:18px 0 0;padding:14px 16px;background:linear-gradient(90deg,rgba(255,87,34,0.08),rgba(0,198,255,0.08));border-radius:10px;font-size:12px;line-height:1.5;color:#475569;text-align:center;">
              <strong style="color:#FF5722;">Just Vybe It!</strong> — Shop live. Sell live. All in one place.
            </p>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#94A3B8;max-width:600px;line-height:1.5;text-align:center;">
        Sent to ${escapeHtml(params.recipientEmail)}. This is an automated message from VybeKart — please contact
        <a href="mailto:${escapeHtml(b.supportEmail)}" style="color:#64748B;">${escapeHtml(b.supportEmail)}</a> for help.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
