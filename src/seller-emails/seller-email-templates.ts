import { ConfigService } from '@nestjs/config';
import {
  buildVybeKartMailShellHtml,
  escapeHtml,
  getVybeKartMailBranding,
  VYBEKART_BRAND_NAME,
} from '../mail/templates/vybekart-email-layout';
import { buildSellerInterestUrl } from '../seller-outreach/seller-outreach-interest.util';
import { resolvePublicBaseUrl } from '../common/utils/public-base-url';
import { BuiltSellerEmail } from './seller-email.types';
import {
  collectAttachments,
  ResolvedEmailImage,
  VYBEKART_PLAY_STORE_URL,
} from './seller-email-images.util';

export interface SellerEmailBuildParams {
  recipientEmail: string;
  storeName: string;
  contactName: string;
  visibilityImageSrc?: string;
  stepsImageSrc?: string;
  interestUrl?: string;
  appDownloadUrl?: string;
  ceoName?: string;
  ceoEmail?: string;
  ceoPhone?: string;
  website?: string;
}

function inlineEmailImageHtml(opts: {
  src: string;
  alt: string;
  maxWidth?: number;
}): string {
  if (!opts.src) return '';
  const src = escapeHtml(opts.src);
  const alt = escapeHtml(opts.alt);
  const w = opts.maxWidth ?? 536;
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border-collapse:collapse;">
      <tr><td align="center" style="padding:0;">
        <img src="${src}" alt="${alt}" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;border-radius:12px;"/>
      </td></tr>
    </table>`.trim();
}

function contactFirstName(contactName: string): string {
  const first = contactName.trim().split(/\s+/)[0];
  return first || contactName.trim() || 'there';
}

function ceoSignatureHtml(p: {
  ceoName?: string;
  ceoEmail?: string;
  ceoPhone?: string;
}): string {
  const phone = escapeHtml(p.ceoPhone || '');
  const ceoEmail = escapeHtml(p.ceoEmail || 'ceo@vybekart.co.in');
  const ceoName = escapeHtml(p.ceoName || 'Hiren Prajapati');

  return `
    <p style="margin:0;font-size:15px;line-height:1.6;color:#1A1D24;">
      Best regards,<br/>
      <strong>${ceoName}</strong><br/>
      Founder &amp; CEO, ${escapeHtml(VYBEKART_BRAND_NAME)}<br/>
      <span style="color:#64748B;font-size:14px;">Happy to answer any questions.</span><br/><br/>
      Email: <a href="mailto:${ceoEmail}" style="color:#1565C0;text-decoration:none;">${ceoEmail}</a><br/>
      Mobile: <a href="tel:${phone}" style="color:#1565C0;text-decoration:none;">${phone}</a>
    </p>`.trim();
}

function sellerInterestButtonHtml(interestUrl: string): string {
  const href = escapeHtml(interestUrl);
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 24px;">
      <tr>
        <td style="border-radius:999px;background:#0B1E5B;">
          <a href="${href}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.02em;">
            Yes, I&rsquo;d like to learn more
          </a>
        </td>
      </tr>
    </table>`.trim();
}

export function sellerEmail1Subject(contactName: string, storeName: string): string {
  return `${contactFirstName(contactName)}, a quick note about ${storeName}`;
}

export function sellerEmail2Subject(storeName: string): string {
  return `Re: ${storeName} — following up`;
}

export function buildSellerEmail1(
  config: ConfigService,
  p: SellerEmailBuildParams,
): Omit<BuiltSellerEmail, 'attachments'> {
  const branding = getVybeKartMailBranding(config);
  const website = escapeHtml(p.website || branding.websiteUrl);
  const visibilityImage = inlineEmailImageHtml({
    src: p.visibilityImageSrc || '',
    alt: 'Products with limited reach online',
  });

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Hi <strong>${escapeHtml(p.contactName)}</strong>,
    </p>
    ${visibilityImage}
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      You create beautiful products — but reaching the right customers is still the hard part.
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Social media reach is unpredictable. Marketplaces are crowded. Great products get lost in the noise.
    </p>
    <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#1A1D24;">
      A single post often disappears in a crowded feed — your work deserves a steadier audience.
    </p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      We’re building something for fashion brands like <strong>${escapeHtml(p.storeName)}</strong> — a better way to be seen, connect in real time, and sell with confidence. I’ll share more in my next note.
    </p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      You can read more at <a href="${website}" style="color:#1565C0;text-decoration:none;">vybekart.co.in</a>.
    </p>
    ${ceoSignatureHtml(p)}
  `.trim();

  const html = buildVybeKartMailShellHtml({
    branding,
    recipientEmail: p.recipientEmail,
    headerBadge: 'From our founder',
    headerTitle: 'Thought this might be relevant for you',
    headerSubtitle: `Regarding ${escapeHtml(p.storeName)}`,
    bodyHtml,
    whyReceivedHtml: `I’m reaching out personally because we think ${escapeHtml(p.storeName)} could be a good fit for what we’re building at ${escapeHtml(VYBEKART_BRAND_NAME)}.`,
    hideDeliveryNotice: false,
    personalTouch: true,
  });

  const ceoName = p.ceoName || 'Hiren Prajapati';
  const ceoEmail = p.ceoEmail || 'ceo@vybekart.co.in';
  const phone = p.ceoPhone || '';

  const text = [
    `Hi ${p.contactName},`,
    '',
    'You create beautiful products — but reaching the right customers is still the hard part.',
    '',
    'Social media reach is unpredictable. Marketplaces are crowded. Great products get lost in the noise.',
    '',
    'A single post often disappears in a crowded feed — your work deserves a steadier audience.',
    '',
    `We’re building something for fashion brands like ${p.storeName} — a better way to be seen, connect in real time, and sell with confidence. I’ll share more in my next note.`,
    '',
    `Learn more: ${p.website || branding.websiteUrl}`,
    '',
    'Best regards,',
    ceoName,
    `Founder & CEO, ${VYBEKART_BRAND_NAME}`,
    '',
    `Email: ${ceoEmail}`,
    `Mobile: ${phone}`,
  ].join('\n');

  return { subject: sellerEmail1Subject(p.contactName, p.storeName), html, text };
}

export function buildSellerEmail2(
  config: ConfigService,
  p: SellerEmailBuildParams,
): Omit<BuiltSellerEmail, 'attachments'> {
  const branding = getVybeKartMailBranding(config);
  const appUrl = escapeHtml(p.appDownloadUrl || VYBEKART_PLAY_STORE_URL);
  const phone = escapeHtml(p.ceoPhone || '');
  const stepsImage = inlineEmailImageHtml({
    src: p.stepsImageSrc || '',
    alt: 'Steps to go live and sell on Vybekart',
  });
  const interestBtn = p.interestUrl
    ? sellerInterestButtonHtml(p.interestUrl)
    : '';

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Hi <strong>${escapeHtml(p.contactName)}</strong>,
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Following up on my last note — we talked about how hard it can be to reach the right customers for your products.
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      That’s why we built <strong style="color:#1565C0;">${escapeHtml(VYBEKART_BRAND_NAME)}</strong> — a live-commerce marketplace where customers discover products, talk to sellers in real time, and shop with confidence.
    </p>
    <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#1A1D24;">
      We’re working closely with a small group of fashion brands during our early launch so each store gets dedicated support.
    </p>
    ${stepsImage}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F0F8FF;border:1px solid #CFE8FF;border-radius:12px;margin:0 0 24px;">
      <tr><td style="padding:20px 22px;">
        <p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#1565C0;">If you’d like to continue, here’s what to do:</p>
        <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#1A1D24;">1. Tap <strong>Yes, I&rsquo;d like to learn more</strong> below so we know you&rsquo;re interested</p>
        <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#1A1D24;">2. Get the Vybekart app using the button below</p>
        <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#1A1D24;">3. Share the following details with us:</p>
        <ul style="margin:0;padding-left:20px;font-size:15px;line-height:1.7;color:#1A1D24;">
          <li>Store name</li>
          <li>Store address</li>
          <li>Contact number</li>
        </ul>
      </td></tr>
    </table>
    ${interestBtn}
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 28px;">
      <tr>
        <td style="border-radius:999px;background:linear-gradient(135deg,#00C6FF,#1565C0);">
          <a href="${appUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;">
            Get the Vybekart app
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#1A1D24;">Have questions?</p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Call us at <a href="tel:${phone}" style="color:#1565C0;text-decoration:none;font-weight:600;">${phone}</a>
    </p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      I’d love to explore how <strong>${escapeHtml(p.storeName)}</strong> could work with ${escapeHtml(VYBEKART_BRAND_NAME)}.
    </p>
    ${ceoSignatureHtml(p)}
  `.trim();

  const html = buildVybeKartMailShellHtml({
    branding,
    recipientEmail: p.recipientEmail,
    headerBadge: 'Following up',
    headerTitle: 'How live selling works on Vybekart',
    headerSubtitle: `Next steps for ${escapeHtml(p.storeName)}`,
    bodyHtml,
    whyReceivedHtml: `This is a follow-up to my earlier note about ${escapeHtml(p.storeName)} and ${escapeHtml(VYBEKART_BRAND_NAME)}.`,
    hideDeliveryNotice: false,
    personalTouch: true,
  });

  const ceoName = p.ceoName || 'Hiren Prajapati';
  const ceoEmail = p.ceoEmail || 'ceo@vybekart.co.in';

  const text = [
    `Hi ${p.contactName},`,
    '',
    'Following up on my last note — we talked about how hard it can be to reach the right customers for your products.',
    '',
    `That’s why we built ${VYBEKART_BRAND_NAME} — a live-commerce marketplace where customers discover products, talk to sellers in real time, and shop with confidence.`,
    '',
    'We’re working closely with a small group of fashion brands during our early launch so each store gets dedicated support.',
    '',
    'Steps to go live and sell on Vybekart — see the infographic in the HTML version of this email.',
    '',
    'If you’d like to continue:',
    '1. Tap “Yes, I\'d like to learn more” in the email (we\'ll get an instant notification)',
    `2. Get the Vybekart app: ${p.appDownloadUrl || VYBEKART_PLAY_STORE_URL}`,
    '3. Share your store name, store address, and contact number',
    '',
    'Have questions?',
    `Call us at ${p.ceoPhone || ''}`,
    '',
    `I’d love to explore how ${p.storeName} could work with ${VYBEKART_BRAND_NAME}.`,
    '',
    'Best regards,',
    ceoName,
    `Founder & CEO, ${VYBEKART_BRAND_NAME}`,
    '',
    `Email: ${ceoEmail}`,
    `Mobile: ${p.ceoPhone || ''}`,
  ].join('\n');

  return { subject: sellerEmail2Subject(p.storeName), html, text };
}

export function resolveInterestUrl(
  config: ConfigService,
  recipient: { email: string; storeName: string; contactName: string },
): string {
  const secret =
    config.get<string>('SELLER_OUTREACH_INTEREST_SECRET')?.trim() ||
    config.get<string>('JWT_SECRET')?.trim() ||
    '';
  if (!secret) {
    throw new Error(
      'Set JWT_SECRET or SELLER_OUTREACH_INTEREST_SECRET for Email 2 interest links',
    );
  }
  const apiBase = resolvePublicBaseUrl(config);
  return buildSellerInterestUrl(
    apiBase,
    {
      email: recipient.email,
      store: recipient.storeName,
      contact: recipient.contactName,
    },
    secret,
  );
}

export function mergeBuiltWithAttachments(
  built: Omit<BuiltSellerEmail, 'attachments'>,
  images: ResolvedEmailImage[],
): BuiltSellerEmail {
  return { ...built, attachments: collectAttachments(images) };
}
