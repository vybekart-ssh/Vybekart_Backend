/**
 * Alpha / APK invite email body (HTML + text + subject). Used by bulk senders.
 */

import {
  buildVybeKartMailShellHtml,
  escapeHtml,
  getVybeKartMailBranding,
  heroImageHtml,
  type VybeKartMailBranding,
} from '../email/vybekart-email-layout';
import type { RegistrationRow } from '../email/registrations-csv';

export interface AlphaInviteBranding extends VybeKartMailBranding {
  driveUrl: string;
  sellerUrl: string;
  replyTo: string;
}

export function getAlphaInviteBranding(): AlphaInviteBranding {
  const base = getVybeKartMailBranding();
  return {
    ...base,
    driveUrl:
      process.env.ALPHA_DRIVE_URL ||
      'https://drive.google.com/drive/folders/1DUobwSc-sBDoijr5RA6OpH_T5oXS9tPp?usp=sharing',
    sellerUrl: process.env.ALPHA_SELLER_URL || '',
    replyTo: process.env.ALPHA_REPLY_TO || 'support@vybekart.co.in',
  };
}

export async function verifyAlphaLogoUrlIfSet(url: string): Promise<void> {
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

function firstName(full: string): string {
  const t = (full || '').trim();
  if (!t) return 'there';
  return t.split(/\s+/)[0] || 'there';
}

function personalizedIntro(row: RegistrationRow, b: AlphaInviteBranding): string {
  const fn = firstName(row.name);
  const role =
    row.registration_type === 'seller'
      ? 'as an early seller partner'
      : 'as an early shopper';
  let s = `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">Dear ${escapeHtml(fn)},</p>`;
  s += `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">Thank you for joining VybeKart ${role} through <a href="${escapeHtml(b.websiteUrl)}" style="color:#1565C0;">vybekart.co.in</a>. Your early access is now live.</p>`;
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

function buyerContentHtml(): string {
  return `
    <p style="margin:0 0 10px;font-size:16px;line-height:1.6;color:#1A1D24;"><strong>Still shopping fashion through static images?</strong></p>
    <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#1A1D24;">Not sure about fit, color, or quality? Returns may be free, but your time isn’t.</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">With VybeKart, you can see it <strong>LIVE</strong> before you buy.</p>

    <p style="margin:0 0 10px;font-size:16px;line-height:1.6;color:#1A1D24;">On VybeKart you can:</p>
    <ul style="margin:0 0 18px;padding-left:20px;font-size:16px;line-height:1.65;color:#1A1D24;">
      <li style="margin:0 0 8px;">See outfits in real time</li>
      <li style="margin:0 0 8px;">Ask questions before buying</li>
      <li style="margin:0 0 8px;">Check fit, fabric, and true color live</li>
      <li style="margin:0 0 0;">Discover unique styles and deals</li>
    </ul>

    <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#1A1D24;"><strong>No more guessing. No more disappointment.</strong></p>
    <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#1A1D24;">We’re building VybeKart with you—your honest feedback will directly shape the experience.</p>
  `.trim();
}

function sellerContentHtml(): string {
  return `
    <p style="margin:0 0 10px;font-size:16px;line-height:1.6;color:#1A1D24;"><strong>Still selling fashion through static images?</strong></p>
    <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#1A1D24;">Customers ask about size, fit, fabric, and real color—and even after that, returns still happen.</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">With VybeKart, your customers can see your products <strong>LIVE</strong> before buying.</p>

    <p style="margin:0 0 10px;font-size:16px;line-height:1.6;color:#1A1D24;">What VybeKart helps you do:</p>
    <ul style="margin:0 0 18px;padding-left:20px;font-size:16px;line-height:1.65;color:#1A1D24;">
      <li style="margin:0 0 8px;">Showcase products <strong>LIVE</strong></li>
      <li style="margin:0 0 8px;">Answer customer questions in real time</li>
      <li style="margin:0 0 8px;">Build trust instantly (fewer returns, higher conversions)</li>
      <li style="margin:0 0 0;">Reach buyers actively shopping women’s fashion</li>
    </ul>

    <p style="margin:0 0 10px;font-size:16px;line-height:1.6;color:#1A1D24;">Why join early:</p>
    <ul style="margin:0 0 18px;padding-left:20px;font-size:16px;line-height:1.65;color:#1A1D24;">
      <li style="margin:0 0 8px;">Better visibility for early seller partners</li>
      <li style="margin:0 0 8px;">Direct support from our team</li>
      <li style="margin:0 0 0;">Grow with us from day one</li>
    </ul>

    <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#1A1D24;">We’re inviting you to partner with us as an early <strong>seller partner</strong>. As promised: when buying becomes active on the platform, we’ll take <strong>0% commission for 1 month</strong> from you.</p>
    <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#1A1D24;">Try it once. We’re continuously improving to help your sales grow—whether you sell offline or online—and we’ll work closely with you as we build.</p>
  `.trim();
}

export function buildAlphaInviteHtml(
  row: RegistrationRow,
  b: AlphaInviteBranding,
): string {
  const intro = personalizedIntro(row, b);
  const isSeller = row.registration_type === 'seller';
  const primaryUrl = isSeller ? (b.sellerUrl || b.driveUrl) : b.driveUrl;
  const primaryLabel = isSeller
    ? 'Get seller partner early access'
    : 'Download the app (APK)';
  const bodyContent = isSeller ? sellerContentHtml() : buyerContentHtml();
  const innerBody = `
              ${intro}
              ${heroImageHtml(b)}
              ${bodyContent}
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">This is an <strong>alpha</strong> build, so you may notice a few rough edges. <strong>If the app takes a little longer to open</strong>, please wait a minute and then restart the application—it should work fine. Please use the <strong>Feedback</strong> option inside the app (Profile / Help area) to tell us what worked, what didn’t, and what you want next—your input directly shapes VybeKart.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;">
                <tr>
                  <td style="border-radius:8px;background:#1E88E5;">
                    <a href="${escapeHtml(primaryUrl)}" style="display:inline-block;padding:14px 28px;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:600;">${escapeHtml(primaryLabel)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#64748B;">Prefer the web experience? Visit <a href="${escapeHtml(b.websiteUrl)}" style="color:#1565C0;font-weight:600;">vybekart.co.in</a> anytime.</p>
              <p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#64748B;">If you know others who would benefit from live shopping or selling, feel free to share the website or this email—there is no obligation; we simply welcome thoughtful early adopters who can help us refine the Vybe.</p>
  `.trim();
  return buildVybeKartMailShellHtml({
    branding: b,
    recipientEmail: row.email,
    bodyHtml: innerBody,
    whyReceivedHtml: `You submitted an early-access or pre-registration form on vybekart.co.in. This message is a one-time product update with download instructions.`,
    postLinksHtml:
      'Alpha software is provided as-is. Features and availability may change. By using the app you agree to our Terms and acknowledge our Privacy Policy.',
  });
}

export function buildAlphaInviteText(
  row: RegistrationRow,
  b: AlphaInviteBranding,
): string {
  const fn = firstName(row.name);
  const isSeller = row.registration_type === 'seller';
  const primaryUrl = isSeller ? (b.sellerUrl || b.driveUrl) : b.driveUrl;
  const lines = [
    `Dear ${fn},`,
    '',
    `Thank you for joining VybeKart (${isSeller ? 'seller partner' : 'shopper'}) via vybekart.co.in. Your early access is now live.`,
    '',
    isSeller
      ? 'Still selling fashion through static images? Let customers see your products LIVE, ask questions, and buy with confidence. We’d love to partner with you as an early seller partner on VybeKart.'
      : 'Still shopping fashion through static images? See outfits LIVE before buying and check fit, fabric, and true color in real time.',
    '',
    isSeller ? `Get seller partner early access: ${primaryUrl}` : `Download the app (APK): ${primaryUrl}`,
    `Website: ${b.websiteUrl}`,
    '',
    'This is an alpha build. If the app takes a little longer to open, please wait a minute and then restart the application—it should work fine.',
    'Please use the in-app Feedback option (Profile / Help area) or reply to this email with what worked and what we should improve.',
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

export function alphaInviteSubjectFor(row: RegistrationRow): string {
  const fn = firstName(row.name);
  const isSeller = row.registration_type === 'seller';
  const suffixRaw = (process.env.ALPHA_SUBJECT_SUFFIX || '').trim();
  const suffix = suffixRaw ? ` ${suffixRaw}` : '';
  if (isSeller) return `Partner with VybeKart - Early Access${suffix}`;

  if (fn === 'there') return `Your VybeKart Android early access is ready${suffix}`;
  return `${fn}, your VybeKart early access is ready${suffix}`;
}
