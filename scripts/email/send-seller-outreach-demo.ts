/**
 * Email 2 — seller partner invitation (5 steps to go live image).
 *
 * Preview: npm run email-2:preview
 * Send:    npm run email-2:demo
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  buildVybeKartMailShellHtml,
  escapeHtml,
  getVybeKartMailBranding,
  VYBEKART_BRAND_NAME,
} from './vybekart-email-layout';
import { loadBackendDotEnv } from './registrations-csv';
import {
  ceoSignatureHtml,
  collectAttachments,
  inlineEmailImageHtml,
  resolveCeoDefaults,
  resolveSellerEmailImage,
  resolveSellerOutreachFrom,
  resolveSellerInterestUrl,
  sellerInterestButtonHtml,
  SELLER_EMAIL_ASSET_FILES,
  sendViaResend,
  VYBEKART_PLAY_STORE_URL,
} from './seller-email-shared';

loadBackendDotEnv();

export interface SellerOutreachParams {
  recipientEmail: string;
  storeName: string;
  contactName: string;
  appDownloadUrl: string;
  stepsImageSrc: string;
  interestUrl: string;
  ceoName?: string;
  ceoEmail?: string;
  ceoPhone?: string;
}

export function sellerOutreachSubject(storeName: string): string {
  return `${storeName} — Invitation to join ${VYBEKART_BRAND_NAME}’s seller partner program`;
}

function bodyInnerHtml(p: SellerOutreachParams): string {
  const appUrl = escapeHtml(p.appDownloadUrl);
  const phone = escapeHtml(p.ceoPhone || '');
  const stepsImage = inlineEmailImageHtml({
    src: p.stepsImageSrc,
    alt: '5 simple steps to go live and sell on Vybekart',
  });

  return `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Hi <strong>${escapeHtml(p.contactName)}</strong>,
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      In our previous email, we talked about the challenge of getting enough visibility for your products.
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">
      That’s why we built <strong style="color:#1565C0;">${escapeHtml(VYBEKART_BRAND_NAME)}</strong> — a live-commerce marketplace where customers discover products, interact with seller partners in real time, and shop with confidence.
    </p>
    <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#1A1D24;">
      We’re onboarding a limited group of fashion seller partners for our early launch, so we can provide dedicated support to each seller partner.
    </p>
    ${stepsImage}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F0F8FF;border:1px solid #CFE8FF;border-radius:12px;margin:0 0 24px;">
      <tr><td style="padding:20px 22px;">
        <p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#1565C0;">If you’d like to be considered, please:</p>
        <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#1A1D24;">1. Tap <strong>I&rsquo;m Interested</strong> below so we know you&rsquo;d like to join</p>
        <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#1A1D24;">2. Download the Vybekart app using the button below</p>
        <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#1A1D24;">3. Share the following details with us:</p>
        <ul style="margin:0;padding-left:20px;font-size:15px;line-height:1.7;color:#1A1D24;">
          <li>Store name</li>
          <li>Store address</li>
          <li>Contact number</li>
        </ul>
      </td></tr>
    </table>

    ${sellerInterestButtonHtml(p.interestUrl)}

    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 28px;">
      <tr>
        <td style="border-radius:999px;background:linear-gradient(135deg,#00C6FF,#1565C0);">
          <a href="${appUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;">
            Download Vybekart App
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#1A1D24;">Have questions?</p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      Call us at <a href="tel:${phone}" style="color:#1565C0;text-decoration:none;font-weight:600;">${phone}</a>
    </p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1D24;">
      We look forward to welcoming <strong>${escapeHtml(p.storeName)}</strong> to ${escapeHtml(VYBEKART_BRAND_NAME)}.
    </p>

    ${ceoSignatureHtml(p)}
  `.trim();
}

export function buildSellerOutreachHtml(p: SellerOutreachParams): string {
  const branding = getVybeKartMailBranding();
  return buildVybeKartMailShellHtml({
    branding,
    recipientEmail: p.recipientEmail,
    headerBadge: 'Seller partners',
    headerTitle: 'Sell. Live. Engage.',
    headerSubtitle: `Join ${VYBEKART_BRAND_NAME}’s early seller partner program`,
    bodyHtml: bodyInnerHtml(p),
    whyReceivedHtml: `We believe ${escapeHtml(p.storeName)} may be a fit for ${escapeHtml(VYBEKART_BRAND_NAME)}’s seller partner program.`,
  });
}

export function buildSellerOutreachText(p: SellerOutreachParams): string {
  const ceoName = p.ceoName || 'Hiren Prajapati';
  const ceoEmail = p.ceoEmail || 'ceo@vybekart.co.in';
  const phone = p.ceoPhone || '';

  return [
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
    `2. Download the Vybekart app: ${p.appDownloadUrl}`,
    '3. Share your store name, store address, and contact number',
    '',
    'Have questions?',
    `Call us at ${phone}`,
    '',
    `We look forward to welcoming ${p.storeName} to ${VYBEKART_BRAND_NAME}.`,
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
  const { ceoName, ceoEmail, ceoPhone } = resolveCeoDefaults();
  const appDownloadUrl =
    process.env.APP_DOWNLOAD_URL?.trim() || VYBEKART_PLAY_STORE_URL;
  const apiBaseUrl =
    process.env.API_PUBLIC_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim() ||
    'http://localhost:3000';

  const stepsImage = resolveSellerEmailImage({
    envUrlKey: 'SELLER_STEPS_IMAGE_URL',
    assetFileName: SELLER_EMAIL_ASSET_FILES.goLiveSteps,
    objectKey: `email/${SELLER_EMAIL_ASSET_FILES.goLiveSteps}`,
    contentId: 'seller-go-live-steps',
    forPreview: preview,
  });

  const interestUrl = resolveSellerInterestUrl({
    apiBaseUrl,
    recipientEmail: to || 'demo@example.com',
    storeName,
    contactName,
  });

  const params: SellerOutreachParams = {
    recipientEmail: to || 'demo@example.com',
    storeName,
    contactName,
    appDownloadUrl,
    stepsImageSrc: stepsImage.src,
    interestUrl,
    ceoName,
    ceoEmail,
    ceoPhone,
  };

  const html = buildSellerOutreachHtml(params);
  const text = buildSellerOutreachText(params);
  const subject = sellerOutreachSubject(storeName);
  const attachments = collectAttachments([stepsImage]);

  if (preview) {
    const out = path.join(__dirname, 'seller-outreach-preview.html');
    fs.writeFileSync(out, html, 'utf8');
    console.log('Preview saved:', out);
    console.log('Interest URL (test in browser after deploy):', interestUrl);
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
  console.log('Interest URL:', interestUrl);
  console.log(
    'Image:',
    stepsImage.attachment
      ? `embedded (${stepsImage.attachment.filename})`
      : stepsImage.src,
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
