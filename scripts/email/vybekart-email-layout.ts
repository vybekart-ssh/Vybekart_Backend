/**
 * Shared Vybekart transactional HTML email shell (header, footer, contact block).
 */

export const VYBEKART_BRAND_NAME = 'Vybekart';

export const VYBE_THEME = {
  cyan: '#00C6FF',
  royal: '#003BFF',
  navy: '#0B1E5B',
  primary: '#1E88E5',
  primaryDark: '#1565C0',
  bgLight: '#F0F4F8',
  bgDark: '#0A0D14',
  surfaceLight: '#FFFFFF',
  surfaceDark: '#121826',
  textLight: '#1A1D24',
  textDark: '#F8FAFC',
  textMutedLight: '#64748B',
  textMutedDark: '#94A3B8',
  borderLight: '#E2E8F0',
  borderDark: '#2D3548',
} as const;

const EMBEDDED_LOGO_DATA_URI =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="62" viewBox="0 0 200 220" fill="none"><defs><linearGradient id="g" x1="100" y1="48" x2="100" y2="172" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#00C6FF"/><stop offset="0.55" stop-color="#0066FF"/><stop offset="1" stop-color="#003BFF"/></linearGradient></defs><ellipse cx="100" cy="182" rx="48" ry="11" fill="#000" opacity="0.2"/><path d="M66 48h68l14 102q2 18-16 22H68q-18-4-16-22Z" fill="url(#g)"/><path d="M88 92v36l36-18Z" fill="#0028A8" stroke="#FFF" stroke-width="4" stroke-linejoin="round"/></svg>`,
  );

const HEADER_GRADIENT_DATA_URI =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240" preserveAspectRatio="none" viewBox="0 0 600 240"><defs><linearGradient id="vk" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#00C6FF"/><stop offset="32%" stop-color="#1E88E5"/><stop offset="58%" stop-color="#1565C0"/><stop offset="100%" stop-color="#0B1E5B"/></linearGradient></defs><rect width="600" height="240" fill="url(#vk)"/></svg>`,
  );

function headerGradientCellStyle(): string {
  return [
    `background-color:${VYBE_THEME.primaryDark}`,
    `background-image:url('${HEADER_GRADIENT_DATA_URI}')`,
    'background-repeat:no-repeat',
    'background-size:100% 100%',
    'background-position:center center',
  ].join(';');
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface VybeKartMailBranding {
  websiteUrl: string;
  logoUrl: string;
  heroImageUrl: string;
  supportEmail: string;
  supportPhone: string;
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

export function resolveEmailLogoUrl(): string {
  const explicit = process.env.ALPHA_LOGO_URL?.trim();
  if (explicit) return normalizeLogoUrlForEmail(explicit);

  const supabase = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
  if (supabase) {
    const bucket = process.env.SUPABASE_PUBLIC_BUCKET?.trim() || 'Vybekart';
    const key =
      process.env.VYBEKART_EMAIL_LOGO_PATH?.trim() || 'vybekart_logo.png';
    return normalizeLogoUrlForEmail(
      `${supabase}/storage/v1/object/public/${encodeURIComponent(bucket)}/${key.replace(/^\/+/, '')}`,
    );
  }

  return EMBEDDED_LOGO_DATA_URI;
}

export function getVybeKartMailBranding(): VybeKartMailBranding {
  return {
    websiteUrl: process.env.ALPHA_WEBSITE_URL || 'https://vybekart.co.in',
    logoUrl: resolveEmailLogoUrl(),
    heroImageUrl: process.env.ALPHA_HERO_IMAGE_URL?.trim() || '',
    supportEmail: process.env.ALPHA_SUPPORT_EMAIL || 'support@vybekart.co.in',
    supportPhone: process.env.ALPHA_SUPPORT_PHONE || '',
    companyLegalName:
      process.env.ALPHA_COMPANY_LEGAL_NAME || VYBEKART_BRAND_NAME,
    termsUrl: process.env.ALPHA_TERMS_URL || 'https://vybekart.co.in/terms',
    privacyUrl: process.env.ALPHA_PRIVACY_URL || 'https://vybekart.co.in/privacy',
  };
}

function headerLogoMarkHtml(b: VybeKartMailBranding): string {
  const home = escapeHtml(b.websiteUrl);
  const rawLogo = (b.logoUrl ?? '').trim();
  const src = escapeHtml(
    rawLogo && !rawLogo.startsWith('data:') ? rawLogo : '',
  );
  const alt = escapeHtml(VYBEKART_BRAND_NAME);
  if (!src) {
    return `<a href="${home}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;font-size:24px;font-weight:800;color:#FFF;">${alt}</a>`;
  }
  return `<span class="vk-logo-shield" style="display:inline-block;line-height:0;color-scheme:light only;">
<a href="${home}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;border:0;display:inline-block;line-height:0;">
<img class="vk-logo-img" src="${src}" width="56" height="56" border="0" alt="${alt}" style="display:block;width:56px;max-width:56px;height:auto;border:0;outline:none;-ms-interpolation-mode:bicubic;"/>
</a>
</span>`;
}

function headerHeroVisualHtml(b: VybeKartMailBranding): string {
  if (b.heroImageUrl) {
    const src = escapeHtml(b.heroImageUrl);
    return `<img src="${src}" width="120" height="120" alt="" style="display:block;width:120px;height:120px;object-fit:contain;border:0;"/>`;
  }
  return `<div style="width:108px;height:108px;border-radius:50%;background:rgba(0,198,255,0.15);border:2px solid rgba(0,198,255,0.45);text-align:center;line-height:108px;font-size:52px;margin:0 0 0 auto;" aria-hidden="true">🛍️</div>`;
}

/** Branded emails always render in light mode — body copy uses inline colors. */
const EMAIL_CLIENT_CSS = `
  html, body { color-scheme: light only; }
  .vk-logo-wrap { color-scheme: light only; }
  .vk-logo-img { filter: none !important; -webkit-filter: none !important; mix-blend-mode: normal !important; }
  @media (prefers-color-scheme: dark) {
    .vk-body { background-color: ${VYBE_THEME.bgLight} !important; }
    .vk-card { background-color: ${VYBE_THEME.surfaceLight} !important; }
    .vk-content { background-color: ${VYBE_THEME.surfaceLight} !important; color: ${VYBE_THEME.textLight} !important; }
    .vk-muted { color: ${VYBE_THEME.textMutedLight} !important; }
    .vk-strong { color: ${VYBE_THEME.navy} !important; }
    .vk-hr { border-top-color: ${VYBE_THEME.borderLight} !important; }
    .vk-link { color: ${VYBE_THEME.primaryDark} !important; }
    .vk-foot { color: ${VYBE_THEME.textMutedLight} !important; }
    .vk-hero-header { color-scheme: light only; }
    .vk-logo-wrap { background-color: #FFFFFF !important; border-color: #E2E8F0 !important; }
    .vk-logo-img { filter: none !important; -webkit-filter: none !important; opacity: 1 !important; }
  }
  [data-ogsc] .vk-logo-img, [data-ogsb] .vk-logo-img, .gmail-dark .vk-logo-img {
    filter: invert(1) hue-rotate(180deg) !important;
    -webkit-filter: invert(1) hue-rotate(180deg) !important;
    opacity: 1 !important;
  }
`.trim();

export function heroImageHtml(b: VybeKartMailBranding): string {
  const src = b.heroImageUrl ? escapeHtml(b.heroImageUrl) : '';
  if (!src) return '';
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;border-collapse:collapse;">
      <tr><td style="padding:0;">
        <div style="border-radius:14px;overflow:hidden;background:${VYBE_THEME.navy};">
          <img src="${src}" alt="Vybekart Live Shopping" width="536" style="display:block;width:100%;max-width:536px;height:220px;object-fit:cover;border:0;"/>
        </div>
      </td></tr>
    </table>`.trim();
}

export function buildVybeKartHeroHeaderHtml(params: {
  branding: VybeKartMailBranding;
  headerBadge: string;
  headerTitle: string;
  headerSubtitle?: string;
}): string {
  const b = params.branding;
  const home = escapeHtml(b.websiteUrl);
  const subtitle = params.headerSubtitle
    ? `<p style="margin:10px 0 0;font-size:14px;line-height:1.45;color:#E3F2FD;">${escapeHtml(params.headerSubtitle)}</p>`
    : '';

  const gradientStyle = headerGradientCellStyle();

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
  <tr><td class="vk-hero-header" style="padding:0;${gradientStyle};">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-image:url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22%3E%3Ccircle cx=%2224%22 cy=%2224%22 r=%222%22 fill=%22%23FFFFFF%22 fill-opacity=%220.12%22/%3E%3C/svg%3E');background-repeat:repeat;">
        <tr><td style="padding:20px 24px 0;">
          <table role="presentation" width="100%"><tr>
            <td align="left">${headerLogoMarkHtml(b)}&nbsp;<a href="${home}" style="text-decoration:none;font-size:24px;font-weight:800;color:#FFF;vertical-align:middle;">${escapeHtml(b.companyLegalName)}</a></td>
            <td align="right"><span style="display:inline-block;padding:8px 14px;border-radius:999px;background:rgba(0,198,255,0.22);border:1px solid rgba(0,198,255,0.55);font-size:13px;font-weight:700;color:#FFF;font-style:italic;">Just Vybe It!</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:18px 24px 28px;">
          <table role="presentation" width="100%"><tr>
            <td width="58%" valign="bottom" style="padding-right:12px;">
              <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.9);">${escapeHtml(params.headerBadge)}</p>
              <h1 style="margin:0;font-size:28px;line-height:1.15;font-weight:800;color:#FFF;">${escapeHtml(params.headerTitle)}</h1>
              ${subtitle}
            </td>
            <td width="42%" align="right" valign="bottom">${headerHeroVisualHtml(b)}</td>
          </tr></table>
        </td></tr>
      </table>
  </td></tr></table>`;
}

export interface VybeKartMailShellOptions {
  branding: VybeKartMailBranding;
  recipientEmail: string;
  bodyHtml: string;
  whyReceivedHtml: string;
  headerBadge?: string;
  headerTitle?: string;
  headerSubtitle?: string;
  postLinksHtml?: string;
}

export function buildVybeKartMailShellHtml(o: VybeKartMailShellOptions): string {
  const b = o.branding;
  const postLinks = o.postLinksHtml
    ? `<p style="margin:12px 0 0;font-size:11px;color:${VYBE_THEME.textMutedLight};">${o.postLinksHtml}</p>`
    : '';
  const hero = buildVybeKartHeroHeaderHtml({
    branding: b,
    headerBadge: o.headerBadge ?? VYBEKART_BRAND_NAME,
    headerTitle: o.headerTitle ?? `Something exciting from ${VYBEKART_BRAND_NAME}`,
    headerSubtitle: o.headerSubtitle ?? 'Shop live. Sell live. All in one place.',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light"/><meta name="supported-color-schemes" content="light"/>
  <style type="text/css">${EMAIL_CLIENT_CSS}</style>
</head>
<body class="vk-body" style="margin:0;padding:0;background-color:${VYBE_THEME.bgLight};color-scheme:light only;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" class="vk-body" width="100%" bgcolor="${VYBE_THEME.bgLight}" style="background-color:${VYBE_THEME.bgLight};padding:28px 12px;"><tr><td align="center">
    <table role="presentation" class="vk-card" width="600" bgcolor="${VYBE_THEME.surfaceLight}" style="max-width:600px;background-color:${VYBE_THEME.surfaceLight};border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(11,30,91,0.12);">
      <tr><td>${hero}</td></tr>
      <tr><td class="vk-content" bgcolor="${VYBE_THEME.surfaceLight}" style="padding:32px 28px;background-color:${VYBE_THEME.surfaceLight};color:${VYBE_THEME.textLight};">
        ${o.bodyHtml}
        <hr class="vk-hr" style="border:none;border-top:1px solid ${VYBE_THEME.borderLight};margin:28px 0 24px;"/>
        <p class="vk-muted" style="margin:0 0 10px;font-size:13px;color:${VYBE_THEME.textMutedLight};"><strong class="vk-strong" style="color:${VYBE_THEME.navy};">Why you received this</strong><br/>${o.whyReceivedHtml}</p>
        <p class="vk-muted" style="margin:16px 0 0;font-size:13px;color:${VYBE_THEME.textMutedLight};"><strong class="vk-strong" style="color:${VYBE_THEME.navy};">${escapeHtml(b.companyLegalName)}</strong><br/>
          ${b.supportPhone ? `Phone: ${escapeHtml(b.supportPhone)}<br/>` : ''}
          Support: <a class="vk-link" href="mailto:${escapeHtml(b.supportEmail)}" style="color:${VYBE_THEME.primaryDark};font-weight:600;text-decoration:none;">${escapeHtml(b.supportEmail)}</a>
        </p>
        <p class="vk-muted" style="margin:14px 0 0;font-size:12px;color:${VYBE_THEME.textMutedLight};">
          <a class="vk-link" href="${escapeHtml(b.termsUrl)}" style="color:${VYBE_THEME.textMutedLight};">Terms</a> · <a class="vk-link" href="${escapeHtml(b.privacyUrl)}" style="color:${VYBE_THEME.textMutedLight};">Privacy</a>
        </p>
        ${postLinks}
        <p class="vk-tagline-box" style="margin:18px 0 0;padding:14px;background:linear-gradient(90deg,rgba(0,198,255,0.1),rgba(30,136,229,0.08));border:1px solid rgba(0,198,255,0.25);border-radius:10px;font-size:12px;color:${VYBE_THEME.textMutedLight};text-align:center;"><strong style="color:${VYBE_THEME.primaryDark};">Just Vybe It!</strong> — Shop live. Sell live. All in one place.</p>
      </td></tr>
    </table>
    <p class="vk-foot" style="margin:16px 0 0;font-size:11px;color:${VYBE_THEME.textMutedLight};text-align:center;">Sent to ${escapeHtml(o.recipientEmail)}</p>
  </td></tr></table>
</body></html>`;
}
