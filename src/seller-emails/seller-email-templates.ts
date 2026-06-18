import { ConfigService } from '@nestjs/config';
import {
  buildSellerPersonalMailHtml,
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
    <p style="margin:0 0 20px;">
      <img src="${src}" alt="${alt}" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;"/>
    </p>`.trim();
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
      <span style="color:#64748B;font-size:14px;">Helping brands connect with customers through live shopping.</span><br/><br/>
      Email: <a href="mailto:${ceoEmail}" style="color:#1565C0;text-decoration:underline;">${ceoEmail}</a><br/>
      Mobile: <a href="tel:${phone}" style="color:#1565C0;text-decoration:underline;">${phone}</a>
    </p>`.trim();
}

function sellerInterestLinkHtml(interestUrl: string): string {
  const href = escapeHtml(interestUrl);
  return `
    <p style="margin:0 0 24px;">
      <a href="${href}" style="color:#1565C0;text-decoration:underline;font-weight:600;">I&rsquo;m Interested</a>
    </p>`.trim();
}

export function sellerEmail1Subject(storeName: string): string {
  return `${storeName} — Your products deserve more visibility`;
}

export function sellerEmail2Subject(storeName: string): string {
  return `${storeName} — Invitation to join ${VYBEKART_BRAND_NAME}’s seller partner program`;
}

export function buildSellerEmail1(
  config: ConfigService,
  p: SellerEmailBuildParams,
): Omit<BuiltSellerEmail, 'attachments'> {
  const branding = getVybeKartMailBranding(config);
  const website = escapeHtml(p.website || branding.websiteUrl);
  const visibilityImage = inlineEmailImageHtml({
    src: p.visibilityImageSrc || '',
    alt: 'Beautiful products — not enough visibility',
  });

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Hi <strong>${escapeHtml(p.contactName)}</strong>,
    </p>
    ${visibilityImage}
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      You create beautiful products — but getting enough visibility is still the hard part.
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Social media reach is unpredictable. Marketplaces are crowded. Great products get lost in the noise.
    </p>
    <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Your products deserve more visibility than a post that disappears in a crowded feed.
    </p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      We’re building something for fashion seller partners like <strong>${escapeHtml(p.storeName)}</strong> — a better way to be seen, connect in real time, and sell with confidence. I’ll share more in my next note.
    </p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Learn more at <a href="${website}" style="color:#1565C0;text-decoration:underline;">vybekart.co.in</a>.
    </p>
    ${ceoSignatureHtml(p)}
  `.trim();

  const html = buildSellerPersonalMailHtml({ bodyHtml });

  const ceoName = p.ceoName || 'Hiren Prajapati';
  const ceoEmail = p.ceoEmail || 'ceo@vybekart.co.in';
  const phone = p.ceoPhone || '';

  const text = [
    `Hi ${p.contactName},`,
    '',
    'You create beautiful products — but getting enough visibility is still the hard part.',
    '',
    'Social media reach is unpredictable. Marketplaces are crowded. Great products get lost in the noise.',
    '',
    'Your products deserve more visibility than a post that disappears in a crowded feed.',
    '',
    `We’re building something for fashion seller partners like ${p.storeName} — a better way to be seen, connect in real time, and sell with confidence. I’ll share more in my next note.`,
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

  return { subject: sellerEmail1Subject(p.storeName), html, text };
}

export function buildSellerEmail2(
  config: ConfigService,
  p: SellerEmailBuildParams,
): Omit<BuiltSellerEmail, 'attachments'> {
  const appUrl = escapeHtml(p.appDownloadUrl || VYBEKART_PLAY_STORE_URL);
  const phone = escapeHtml(p.ceoPhone || '');
  const stepsImage = inlineEmailImageHtml({
    src: p.stepsImageSrc || '',
    alt: '5 simple steps to go live and sell on Vybekart',
  });
  const interestLink = p.interestUrl
    ? sellerInterestLinkHtml(p.interestUrl)
    : '';

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Hi <strong>${escapeHtml(p.contactName)}</strong>,
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      In our previous email, we talked about the challenge of getting enough visibility for your products.
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      That’s why we built <strong>${escapeHtml(VYBEKART_BRAND_NAME)}</strong> — a live-commerce marketplace where customers discover products, interact with seller partners in real time, and shop with confidence.
    </p>
    <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#1A1D24;">
      We’re onboarding a limited group of fashion seller partners for our early launch, so we can provide dedicated support to each seller partner.
    </p>
    ${stepsImage}
    <p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#1A1D24;">If you’d like to be considered, please:</p>
    <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#1A1D24;">1. Tap <strong>I&rsquo;m Interested</strong> below so we know you&rsquo;d like to join</p>
    <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#1A1D24;">2. Download the Vybekart app using the link below</p>
    <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#1A1D24;">3. Share the following details with us:</p>
    <ul style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:1.7;color:#1A1D24;">
      <li>Store name</li>
      <li>Store address</li>
      <li>Contact number</li>
    </ul>
    ${interestLink}
    <p style="margin:0 0 28px;">
      <a href="${appUrl}" style="color:#1565C0;text-decoration:underline;font-weight:600;">Download Vybekart App</a>
    </p>
    <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#1A1D24;">Have questions?</p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Call us at <a href="tel:${phone}" style="color:#1565C0;text-decoration:underline;font-weight:600;">${phone}</a>
    </p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      We look forward to welcoming <strong>${escapeHtml(p.storeName)}</strong> to ${escapeHtml(VYBEKART_BRAND_NAME)}.
    </p>
    ${ceoSignatureHtml(p)}
  `.trim();

  const html = buildSellerPersonalMailHtml({ bodyHtml });

  const ceoName = p.ceoName || 'Hiren Prajapati';
  const ceoEmail = p.ceoEmail || 'ceo@vybekart.co.in';

  const text = [
    `Hi ${p.contactName},`,
    '',
    'In our previous email, we talked about the challenge of getting enough visibility for your products.',
    '',
    `That’s why we built ${VYBEKART_BRAND_NAME} — a live-commerce marketplace where customers discover products, interact with seller partners in real time, and shop with confidence.`,
    '',
    'We’re onboarding a limited group of fashion seller partners for our early launch, so we can provide dedicated support to each seller partner.',
    '',
    '5 simple steps to go live and sell on Vybekart — see the infographic in the HTML version of this email.',
    '',
    'If you’d like to be considered:',
    '1. Tap I\'m Interested in the email (we\'ll get an instant notification)',
    `2. Download the Vybekart app: ${p.appDownloadUrl || VYBEKART_PLAY_STORE_URL}`,
    '3. Share your store name, store address, and contact number',
    '',
    'Have questions?',
    `Call us at ${p.ceoPhone || ''}`,
    '',
    `We look forward to welcoming ${p.storeName} to ${VYBEKART_BRAND_NAME}.`,
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
