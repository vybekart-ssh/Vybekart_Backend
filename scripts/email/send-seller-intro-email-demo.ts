/**
 * Email 1 — visibility problem intro (Beautiful Products image).
 *
 * Preview: npm run seller-intro:preview
 * Send:    npm run seller-intro:demo
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  buildVybeKartMailShellHtml,
  escapeHtml,
  getVybeKartMailBranding,
} from './vybekart-email-layout';
import { loadBackendDotEnv } from './registrations-csv';
import {
  ceoSignatureHtml,
  collectAttachments,
  inlineEmailImageHtml,
  resolveCeoDefaults,
  resolveSellerEmailImage,
  resolveSellerOutreachFrom,
  SELLER_EMAIL_ASSET_FILES,
  sendViaResend,
} from './seller-email-shared';

loadBackendDotEnv();

export interface SellerIntroParams {
  recipientEmail: string;
  storeName: string;
  contactName: string;
  visibilityImageSrc: string;
  ceoName?: string;
  ceoEmail?: string;
  ceoPhone?: string;
  website?: string;
}

export function sellerIntroSubject(storeName: string): string {
  return `${storeName} — Your products deserve more visibility`;
}

function bodyInnerHtml(p: SellerIntroParams): string {
  const website = escapeHtml(p.website || 'https://www.vybekart.co.in');
  const visibilityImage = inlineEmailImageHtml({
    src: p.visibilityImageSrc,
    alt: 'Beautiful products — not enough visibility',
  });

  return `
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
      Learn more at <a href="${website}" style="color:#1565C0;font-weight:600;text-decoration:none;">vybekart.co.in</a>.
    </p>
    ${ceoSignatureHtml(p)}
  `.trim();
}

export function buildSellerIntroHtml(p: SellerIntroParams): string {
  const branding = getVybeKartMailBranding();
  return buildVybeKartMailShellHtml({
    branding,
    recipientEmail: p.recipientEmail,
    headerBadge: 'Seller partners',
    headerTitle: 'Beautiful products deserve visibility.',
    headerSubtitle: 'A note for fashion seller partners',
    bodyHtml: bodyInnerHtml(p),
    whyReceivedHtml: `We believe ${escapeHtml(p.storeName)} may benefit from VybeKart’s live-commerce seller partner program.`,
  });
}

export function buildSellerIntroText(p: SellerIntroParams): string {
  const ceoName = p.ceoName || 'Hiren Prajapati';
  const ceoEmail = p.ceoEmail || 'ceo@vybekart.co.in';
  const phone = p.ceoPhone || '';
  const website = p.website || 'https://www.vybekart.co.in';

  return [
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
    `Learn more: ${website}`,
    '',
    'Best regards,',
    ceoName,
    'Founder & CEO, Vybekart',
    '',
    `Email: ${ceoEmail}`,
    `Mobile: ${phone}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const preview = process.argv.includes('--preview');
  const dryRun =
    process.argv.includes('--dry-run') ||
    String(process.env.DRY_RUN || '').toLowerCase() === 'true';

  const to = process.env.SELLER_OUTREACH_TO?.trim();
  const storeName =
    process.env.SELLER_OUTREACH_STORE_NAME?.trim() || 'Your Store';
  const contactName =
    process.env.SELLER_OUTREACH_CONTACT_NAME?.trim() || storeName;
  const { ceoName, ceoEmail, ceoPhone, website } = resolveCeoDefaults();

  const visibilityImage = resolveSellerEmailImage({
    envUrlKey: 'SELLER_INTRO_IMAGE_URL',
    assetFileName: SELLER_EMAIL_ASSET_FILES.visibilityIntro,
    objectKey: `email/${SELLER_EMAIL_ASSET_FILES.visibilityIntro}`,
    contentId: 'seller-visibility-intro',
    forPreview: preview,
  });

  const params: SellerIntroParams = {
    recipientEmail: to || 'demo@example.com',
    storeName,
    contactName,
    visibilityImageSrc: visibilityImage.src,
    ceoName,
    ceoEmail,
    ceoPhone,
    website,
  };

  const html = buildSellerIntroHtml(params);
  const text = buildSellerIntroText(params);
  const subject = sellerIntroSubject(storeName);
  const attachments = collectAttachments([visibilityImage]);

  if (preview) {
    const out = path.join(__dirname, 'seller-intro-preview.html');
    fs.writeFileSync(out, html, 'utf8');
    console.log('Preview saved:', out);
    return;
  }

  if (!to) {
    console.error('Set SELLER_OUTREACH_TO in .env');
    process.exit(1);
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveSellerOutreachFrom();

  console.log('To:', to);
  console.log('From:', from);
  console.log('Subject:', subject);
  console.log('Store:', storeName);
  console.log(
    'Image:',
    visibilityImage.attachment
      ? `embedded (${visibilityImage.attachment.filename})`
      : visibilityImage.src,
  );

  if (dryRun) {
    console.log('DRY_RUN — not sending.');
    return;
  }

  if (!apiKey) {
    console.error('Missing RESEND_API_KEY');
    process.exit(1);
  }

  const id = await sendViaResend({
    apiKey,
    from,
    to,
    subject,
    html,
    text,
    replyTo: ceoEmail,
    attachments,
  });

  console.log('Sent via Resend. ID:', id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
