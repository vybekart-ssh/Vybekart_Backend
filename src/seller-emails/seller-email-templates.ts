import { ConfigService } from '@nestjs/config';
import {
  buildSellerPersonalMailHtml,
  escapeHtml,
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
  /** When false, omits images and link-heavy blocks (used for live sends). */
  richContent?: boolean;
}

function contactFirstName(contactName: string): string {
  const first = contactName.trim().split(/\s+/)[0];
  return first || contactName.trim() || 'there';
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

function ceoSignatureText(p: {
  ceoName?: string;
  ceoEmail?: string;
  ceoPhone?: string;
}): string {
  const ceoName = p.ceoName || 'Hiren Prajapati';
  const ceoEmail = p.ceoEmail || 'ceo@vybekart.co.in';
  const phone = p.ceoPhone || '';
  return [
    'Best regards,',
    ceoName,
    `Founder & CEO, ${VYBEKART_BRAND_NAME}`,
    ceoEmail,
    phone,
  ].join('\n');
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
      ${ceoName}<br/>
      Founder &amp; CEO, ${escapeHtml(VYBEKART_BRAND_NAME)}<br/>
      ${ceoEmail}<br/>
      ${phone}
    </p>`.trim();
}

export function sellerEmail1Subject(contactName: string): string {
  return `${contactFirstName(contactName)}, quick question`;
}

export function sellerEmail2Subject(contactName: string): string {
  return `Re: ${contactFirstName(contactName)}, quick question`;
}

export function buildSellerEmail1(
  config: ConfigService,
  p: SellerEmailBuildParams,
): Omit<BuiltSellerEmail, 'attachments'> {
  const rich = p.richContent !== false;
  const visibilityImage = rich
    ? inlineEmailImageHtml({
        src: p.visibilityImageSrc || '',
        alt: 'Products with limited reach online',
      })
    : '';

  const websiteLine = rich
    ? `<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      You can read more at vybekart.co.in.
    </p>`
    : `<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Happy to share more if this resonates — just reply to this email.
    </p>`;

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Hi ${escapeHtml(p.contactName)},
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
      I’m building something for fashion brands like ${escapeHtml(p.storeName)} — a better way to be seen, connect in real time, and sell with confidence. I’ll share more in my next note.
    </p>
    ${websiteLine}
    ${ceoSignatureHtml(p)}
  `.trim();

  const html = rich ? buildSellerPersonalMailHtml({ bodyHtml }) : '';

  const textLines = [
    `Hi ${p.contactName},`,
    '',
    'You create beautiful products — but reaching the right customers is still the hard part.',
    '',
    'Social media reach is unpredictable. Marketplaces are crowded. Great products get lost in the noise.',
    '',
    'A single post often disappears in a crowded feed — your work deserves a steadier audience.',
    '',
    `I’m building something for fashion brands like ${p.storeName} — a better way to be seen, connect in real time, and sell with confidence. I’ll share more in my next note.`,
    '',
    rich
      ? `You can read more at vybekart.co.in`
      : 'Happy to share more if this resonates — just reply to this email.',
    '',
    ceoSignatureText(p),
  ];

  return {
    subject: sellerEmail1Subject(p.contactName),
    html,
    text: textLines.join('\n'),
  };
}

export function buildSellerEmail2(
  config: ConfigService,
  p: SellerEmailBuildParams,
): Omit<BuiltSellerEmail, 'attachments'> {
  const rich = p.richContent !== false;
  const appUrl = p.appDownloadUrl || VYBEKART_PLAY_STORE_URL;
  const phone = p.ceoPhone || '';

  const stepsImage = rich
    ? inlineEmailImageHtml({
        src: p.stepsImageSrc || '',
        alt: 'Steps to go live and sell on Vybekart',
      })
    : '';

  const interestBlock = p.interestUrl
    ? rich
      ? `<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      If you’d like to continue, tap here: ${escapeHtml(p.interestUrl)}
    </p>`
      : `<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      If you’d like to continue, reply to this email or use this link:
      ${escapeHtml(p.interestUrl)}
    </p>`
    : '';

  const appBlock = rich
    ? `<p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Get the app: ${escapeHtml(appUrl)}
    </p>`
    : `<p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#1A1D24;">
      App link: ${escapeHtml(appUrl)}
    </p>`;

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Hi ${escapeHtml(p.contactName)},
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Following up on my last note — we talked about how hard it can be to reach the right customers for your products.
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      That’s why I built ${escapeHtml(VYBEKART_BRAND_NAME)} — a live-commerce marketplace where customers discover products, talk to sellers in real time, and shop with confidence.
    </p>
    <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#1A1D24;">
      I’m working closely with a small group of fashion brands during our early launch so each store gets dedicated support.
    </p>
    ${stepsImage}
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#1A1D24;">If you’d like to continue:</p>
    <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#1A1D24;">1. Let me know you’re interested (link below or reply to this email)</p>
    <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#1A1D24;">2. Get the Vybekart app</p>
    <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#1A1D24;">3. Share your store name, address, and contact number</p>
    ${interestBlock}
    ${appBlock}
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Questions? Call me at ${escapeHtml(phone)}.
    </p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      I’d love to explore how ${escapeHtml(p.storeName)} could work with ${escapeHtml(VYBEKART_BRAND_NAME)}.
    </p>
    ${ceoSignatureHtml(p)}
  `.trim();

  const html = rich ? buildSellerPersonalMailHtml({ bodyHtml }) : '';

  const textLines = [
    `Hi ${p.contactName},`,
    '',
    'Following up on my last note — we talked about how hard it can be to reach the right customers for your products.',
    '',
    `That’s why I built ${VYBEKART_BRAND_NAME} — a live-commerce marketplace where customers discover products, talk to sellers in real time, and shop with confidence.`,
    '',
    'I’m working closely with a small group of fashion brands during our early launch so each store gets dedicated support.',
    '',
    ...(rich
      ? [
          'Steps to go live and sell on Vybekart — see the infographic in the HTML version of this email.',
          '',
        ]
      : []),
    'If you’d like to continue:',
    '1. Let me know you’re interested (reply to this email' +
      (p.interestUrl ? ` or open: ${p.interestUrl}` : '') +
      ')',
    `2. Get the Vybekart app: ${appUrl}`,
    '3. Share your store name, address, and contact number',
    '',
    `Questions? Call me at ${phone}.`,
    '',
    `I’d love to explore how ${p.storeName} could work with ${VYBEKART_BRAND_NAME}.`,
    '',
    ceoSignatureText(p),
  ];

  return {
    subject: sellerEmail2Subject(p.contactName),
    html,
    text: textLines.join('\n'),
  };
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
