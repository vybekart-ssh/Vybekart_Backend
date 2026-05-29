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
  supportEmail: string;
  companyLegalName: string;
  termsUrl: string;
  privacyUrl: string;
}

export function getVybeKartMailBranding(config: ConfigService): VybeKartMailBranding {
  return {
    websiteUrl:
      config.get<string>('ALPHA_WEBSITE_URL')?.trim() || 'https://vybekart.co.in',
    logoUrl: config.get<string>('ALPHA_LOGO_URL')?.trim() || '',
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

function headerLogoHtml(b: VybeKartMailBranding): string {
  if (!b.logoUrl) return '';
  const src = escapeHtml(b.logoUrl);
  const home = escapeHtml(b.websiteUrl);
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 12px auto;line-height:0;">
<tr><td align="center" style="padding:0;">
<a href="${home}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;border:0;">
<img src="${src}" width="96" height="96" border="0" alt="VybeKart" style="display:block;width:96px;height:96px;border:0;border-radius:14px;"/>
</a>
</td></tr>
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
  const subtitle = params.headerSubtitle
    ? `<div style="color:rgba(255,255,255,0.92);font-size:14px;margin-top:8px;line-height:1.4;">${escapeHtml(params.headerSubtitle)}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F0F4F8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1E88E5 0%,#1565C0 100%);padding:28px 32px;text-align:center;">
            ${headerLogoHtml(b)}
            <div style="color:rgba(255,255,255,0.85);font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;">${escapeHtml(params.headerBadge)}</div>
            <div style="color:#FFFFFF;font-size:22px;font-weight:700;margin-top:8px;">${escapeHtml(params.headerTitle)}</div>
            <div style="color:#00C6FF;font-size:14px;font-weight:600;margin-top:6px;">Just Vybe it !</div>
            ${subtitle}
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            ${params.bodyHtml}
            <hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0;"/>
            <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#64748B;"><strong style="color:#0B1E5B;">Why you received this</strong><br/>${params.whyReceivedHtml}</p>
            <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#64748B;">
              <strong style="color:#0B1E5B;">${escapeHtml(b.companyLegalName)}</strong><br/>
              Support: <a href="mailto:${escapeHtml(b.supportEmail)}" style="color:#1565C0;">${escapeHtml(b.supportEmail)}</a>
            </p>
            <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#94A3B8;">
              <a href="${escapeHtml(b.termsUrl)}" style="color:#64748B;">Terms &amp; Conditions</a>
              &nbsp;·&nbsp;
              <a href="${escapeHtml(b.privacyUrl)}" style="color:#64748B;">Privacy Policy</a>
            </p>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#94A3B8;max-width:600px;">Sent to ${escapeHtml(params.recipientEmail)}. Please do not reply to this automated message — contact ${escapeHtml(b.supportEmail)} for help.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
