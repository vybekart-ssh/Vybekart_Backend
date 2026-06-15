/**
 * Shared helpers for seller partner outreach emails (intro + invitation).
 */

import * as fs from 'fs';
import * as path from 'path';
import { escapeHtml } from './vybekart-email-layout';
import { buildSellerInterestUrl } from '../../src/seller-outreach/seller-outreach-interest.util';
import { resendFetch } from '../../src/common/utils/resend-fetch';

export const VYBEKART_PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.vybekart.app';

export const SELLER_EMAIL_ASSETS_DIR = path.join(__dirname, 'assets');

const DEFAULT_SUPABASE_HOST =
  'https://axcsnealmdadjryogrnl.supabase.co/storage/v1/object/public/Vybekart/email';

export const SELLER_EMAIL_ASSET_FILES = {
  visibilityIntro: 'seller-visibility-intro.png',
  goLiveSteps: 'seller-go-live-steps.png',
} as const;

export interface ResendInlineAttachment {
  filename: string;
  content: string;
  content_id: string;
  content_type: string;
}

export interface ResolvedEmailImage {
  /** Use in <img src="..."> */
  src: string;
  /** Present when image is embedded via Resend CID attachment */
  attachment?: ResendInlineAttachment;
}

export function resolveCeoDefaults(): {
  ceoName: string;
  ceoEmail: string;
  ceoPhone: string;
  website: string;
} {
  return {
    ceoName: process.env.CEO_NAME?.trim() || 'Hiren Prajapati',
    ceoEmail: process.env.CEO_EMAIL?.trim() || 'ceo@vybekart.co.in',
    ceoPhone: process.env.CEO_PHONE?.trim() || '+91-8169139848',
    website: process.env.ALPHA_WEBSITE_URL?.trim() || 'https://www.vybekart.co.in',
  };
}

/** Outreach sends from the CEO inbox, not global MAIL_FROM / noreply. */
export function resolveSellerOutreachFrom(): string {
  const explicit = process.env.SELLER_OUTREACH_FROM?.trim();
  if (explicit) return explicit;
  const { ceoName, ceoEmail } = resolveCeoDefaults();
  return `${ceoName} <${ceoEmail}>`;
}

function supabasePublicObjectUrl(objectKey: string): string {
  const supabase = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const bucket = process.env.SUPABASE_PUBLIC_BUCKET?.trim() || 'Vybekart';
  if (supabase) {
    return `${supabase}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectKey.replace(/^\/+/, '')}`;
  }
  return `${DEFAULT_SUPABASE_HOST}/${objectKey.replace(/^\/+/, '')}`;
}

function localAssetPath(fileName: string): string {
  return path.join(SELLER_EMAIL_ASSETS_DIR, fileName);
}

function localAssetDataUri(fileName: string): string | null {
  const filePath = localAssetPath(fileName);
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function loadInlineAttachment(
  fileName: string,
  contentId: string,
): ResendInlineAttachment | null {
  const filePath = localAssetPath(fileName);
  if (!fs.existsSync(filePath)) return null;
  return {
    filename: fileName,
    content: fs.readFileSync(filePath).toString('base64'),
    content_id: contentId,
    content_type: 'image/png',
  };
}

/**
 * Preview: local data URI.
 * Send: embed local PNG via Resend CID (reliable — no Supabase upload needed).
 * Fallback: explicit SELLER_*_IMAGE_URL or Supabase public URL.
 */
export function resolveSellerEmailImage(opts: {
  envUrlKey: string;
  assetFileName: string;
  objectKey: string;
  contentId: string;
  forPreview: boolean;
}): ResolvedEmailImage {
  if (opts.forPreview) {
    const dataUri = localAssetDataUri(opts.assetFileName);
    if (dataUri) return { src: dataUri };
    const explicit = process.env[opts.envUrlKey]?.trim();
    if (explicit) return { src: explicit };
    return { src: supabasePublicObjectUrl(opts.objectKey) };
  }

  const attachment = loadInlineAttachment(opts.assetFileName, opts.contentId);
  if (attachment) {
    return { src: `cid:${opts.contentId}`, attachment };
  }

  const explicit = process.env[opts.envUrlKey]?.trim();
  if (explicit) return { src: explicit };

  return { src: supabasePublicObjectUrl(opts.objectKey) };
}

export function inlineEmailImageHtml(opts: {
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

export function ceoSignatureHtml(p: {
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
      Founder &amp; CEO, Vybekart<br/>
      <span style="color:#64748B;font-size:14px;">Helping brands connect with customers through live shopping.</span><br/><br/>
      Email: <a href="mailto:${ceoEmail}" style="color:#1565C0;text-decoration:none;">${ceoEmail}</a><br/>
      Mobile: <a href="tel:${phone}" style="color:#1565C0;text-decoration:none;">${phone}</a>
    </p>`.trim();
}

export async function sendViaResend(opts: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo: string;
  attachments?: ResendInlineAttachment[];
}): Promise<string> {
  const body: Record<string, unknown> = {
    from: opts.from,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    reply_to: opts.replyTo,
    headers: {
      'X-Entity-Ref-ID': `vybekart-seller-${Date.now()}`,
    },
  };

  if (opts.attachments?.length) {
    body.attachments = opts.attachments;
  }

  const res = await resendFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const bodyText = await res.text();
  if (!res.ok) throw new Error(`Resend API ${res.status}: ${bodyText}`);
  try {
    return (JSON.parse(bodyText) as { id?: string }).id || bodyText;
  } catch {
    return bodyText;
  }
}

export function collectAttachments(
  images: ResolvedEmailImage[],
): ResendInlineAttachment[] {
  const out: ResendInlineAttachment[] = [];
  for (const img of images) {
    if (img.attachment) out.push(img.attachment);
  }
  return out;
}

export function resolveSellerInterestUrl(opts: {
  apiBaseUrl: string;
  recipientEmail: string;
  storeName: string;
  contactName: string;
}): string {
  const secret =
    process.env.SELLER_OUTREACH_INTEREST_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    '';
  if (!secret) {
    throw new Error(
      'Set JWT_SECRET or SELLER_OUTREACH_INTEREST_SECRET to build interest links',
    );
  }
  return buildSellerInterestUrl(opts.apiBaseUrl, {
    email: opts.recipientEmail,
    store: opts.storeName,
    contact: opts.contactName,
  }, secret);
}

export function sellerInterestButtonHtml(interestUrl: string): string {
  const href = escapeHtml(interestUrl);
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 24px;">
      <tr>
        <td style="border-radius:999px;background:#0B1E5B;">
          <a href="${href}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.02em;">
            I&rsquo;m Interested
          </a>
        </td>
      </tr>
    </table>`.trim();
}
