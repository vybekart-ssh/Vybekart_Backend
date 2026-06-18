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
  /** Live sends use plain text only (Gmail Primary). Previews use branded HTML. */
  forPreview?: boolean;
}

/** Shared subject — threads intro + follow-up in one conversation. */
export const SELLER_OUTREACH_THREAD_SUBJECT = 'Quick question';

function ceoFirstName(ceoName?: string): string {
  const name = (ceoName || 'Hiren Prajapati').trim();
  return name.split(/\s+/)[0] || name;
}

function humanSignatureText(p: {
  ceoName?: string;
  ceoEmail?: string;
  ceoPhone?: string;
}): string {
  const first = ceoFirstName(p.ceoName);
  const email = p.ceoEmail || 'ceo@vybekart.co.in';
  const phone = p.ceoPhone || '';
  const lines = [first, `Founder, ${VYBEKART_BRAND_NAME}`, email];
  if (phone) lines.push(phone);
  return lines.join('\n');
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
      ${ceoName}<br/>
      Founder, ${escapeHtml(VYBEKART_BRAND_NAME)}<br/>
      ${ceoEmail}<br/>
      ${phone}
    </p>`.trim();
}

export function sellerEmail1Subject(): string {
  return SELLER_OUTREACH_THREAD_SUBJECT;
}

export function sellerEmail2Subject(): string {
  return `Re: ${SELLER_OUTREACH_THREAD_SUBJECT}`;
}

function buildSellerEmail1Text(p: SellerEmailBuildParams): string {
  return [
    `Hi ${p.contactName},`,
    '',
    `I came across ${p.storeName} and had a quick question — how are you finding customers beyond social media and marketplaces right now?`,
    '',
    'A lot of fashion brands I speak with say reach feels unpredictable. One post does well, the next gets buried.',
    '',
    `I'm working on something for stores like yours and wondered if that resonates. No pitch today — just curious if it's on your mind too.`,
    '',
    'If it is, a quick reply is plenty. Happy to share more when useful.',
    '',
    humanSignatureText(p),
  ].join('\n');
}

function buildSellerEmail2Text(p: SellerEmailBuildParams): string {
  const appUrl = p.appDownloadUrl || VYBEKART_PLAY_STORE_URL;
  const phone = p.ceoPhone || '';

  return [
    `Hi ${p.contactName},`,
    '',
    'Following up on my note from earlier.',
    '',
    `I built ${VYBEKART_BRAND_NAME} — live selling where customers can watch, ask questions, and buy in real time. We're onboarding a small group of fashion stores with hands-on support.`,
    '',
    'If you are open to it, reply with a yes along with your store name, address, and phone number. I will take it from there.',
    '',
    `When you are ready, the app is here: ${appUrl}`,
  ...(phone ? ['', `Or call me on ${phone} if easier.`] : []),
    '',
    humanSignatureText(p),
  ].join('\n');
}

function buildSellerEmail1PreviewHtml(
  config: ConfigService,
  p: SellerEmailBuildParams,
): string {
  const branding = getVybeKartMailBranding(config);
  const visibilityImage = inlineEmailImageHtml({
    src: p.visibilityImageSrc || '',
    alt: 'Products with limited reach online',
  });

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Hi ${escapeHtml(p.contactName)},
    </p>
    ${visibilityImage}
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      I came across ${escapeHtml(p.storeName)} and had a quick question — how are you finding customers beyond social media and marketplaces right now?
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      A lot of fashion brands I speak with say reach feels unpredictable. One post does well, the next gets buried.
    </p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      I'm working on something for stores like yours and wondered if that resonates. No pitch today — just curious if it's on your mind too.
    </p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      If it is, a quick reply is plenty. Happy to share more when useful.
    </p>
    ${ceoSignatureHtml(p)}
  `.trim();

  return buildVybeKartMailShellHtml({
    branding,
    recipientEmail: p.recipientEmail,
    headerBadge: 'From our founder',
    headerTitle: 'Quick question',
    headerSubtitle: `Regarding ${escapeHtml(p.storeName)}`,
    bodyHtml,
    whyReceivedHtml: `Personal note about ${escapeHtml(p.storeName)}.`,
    hideDeliveryNotice: true,
    personalTouch: true,
  });
}

function buildSellerEmail2PreviewHtml(
  config: ConfigService,
  p: SellerEmailBuildParams,
): string {
  const branding = getVybeKartMailBranding(config);
  const appUrl = escapeHtml(p.appDownloadUrl || VYBEKART_PLAY_STORE_URL);
  const phone = escapeHtml(p.ceoPhone || '');
  const stepsImage = inlineEmailImageHtml({
    src: p.stepsImageSrc || '',
    alt: 'Steps to go live on Vybekart',
  });

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Hi ${escapeHtml(p.contactName)},
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Following up on my note from earlier.
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      I built ${escapeHtml(VYBEKART_BRAND_NAME)} — live selling where customers can watch, ask questions, and buy in real time. We're onboarding a small group of fashion stores with hands-on support.
    </p>
    ${stepsImage}
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      If you are open to it, reply with a yes along with your store name, address, and phone number.
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      App: ${appUrl}
    </p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      ${phone ? `Or call me on ${phone}.` : ''}
    </p>
    ${ceoSignatureHtml(p)}
  `.trim();

  return buildVybeKartMailShellHtml({
    branding,
    recipientEmail: p.recipientEmail,
    headerBadge: 'Following up',
    headerTitle: 'Re: Quick question',
    headerSubtitle: `Next steps for ${escapeHtml(p.storeName)}`,
    bodyHtml,
    whyReceivedHtml: `Follow-up to my earlier note about ${escapeHtml(p.storeName)}.`,
    hideDeliveryNotice: true,
    personalTouch: true,
  });
}

export function buildSellerEmail1(
  config: ConfigService,
  p: SellerEmailBuildParams,
): Omit<BuiltSellerEmail, 'attachments'> {
  const text = buildSellerEmail1Text(p);
  const html = p.forPreview ? buildSellerEmail1PreviewHtml(config, p) : '';

  return {
    subject: sellerEmail1Subject(),
    html,
    text,
  };
}

export function buildSellerEmail2(
  config: ConfigService,
  p: SellerEmailBuildParams,
): Omit<BuiltSellerEmail, 'attachments'> {
  const text = buildSellerEmail2Text(p);
  const html = p.forPreview ? buildSellerEmail2PreviewHtml(config, p) : '';

  return {
    subject: sellerEmail2Subject(),
    html,
    text,
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
