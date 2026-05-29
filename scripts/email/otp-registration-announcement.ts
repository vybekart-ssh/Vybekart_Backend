/**
 * OTP registration notice for early seller partners and buyers (VybeKart app).
 * Uses the shared VybeKart email shell — same header/footer/contact as alpha APK mail.
 *
 * Preview HTML (stdout → save as .html if needed):
 *   npx ts-node --transpile-only scripts/email/otp-registration-announcement.ts
 *
 * Bulk send from CSV (same list as alpha invite):
 *   npx ts-node --transpile-only scripts/email/send-registrations-mail.ts --mail otp
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  buildVybeKartMailShellHtml,
  escapeHtml,
  getVybeKartMailBranding,
  type VybeKartMailBranding,
} from './vybekart-email-layout';

/** Default app registration OTP communicated to early users (override with REGISTRATION_OTP). */
export const DEFAULT_REGISTRATION_OTP =
  process.env.REGISTRATION_OTP?.trim() || '796300';

/** Suggested subject when sending through Resend or your ESP. */
export const OTP_REGISTRATION_ANNOUNCEMENT_SUBJECT =
  'VybeKart — use this OTP to complete app registration';

function firstName(full: string): string {
  const t = (full || '').trim();
  if (!t) return 'there';
  return t.split(/\s+/)[0] || 'there';
}

export interface OtpAnnouncementParams {
  /** Recipient display name (optional). */
  name?: string;
  recipientEmail: string;
  branding?: VybeKartMailBranding;
  /** Override default OTP for tests or future rotation. */
  otp?: string;
}

function bodyInnerHtml(
  b: VybeKartMailBranding,
  first: string,
  otp: string,
): string {
  const site = escapeHtml(b.websiteUrl);
  const otpDisplay = escapeHtml(otp);
  return `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">Dear ${escapeHtml(first)},</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">We are writing to our <strong>early seller partners</strong> and <strong>buyers</strong> with a quick update about registering on the VybeKart application.</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">For this phase, the application registration OTP is initially set to:</p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 20px;">
      <tr>
        <td style="border-radius:10px;background:#E3F2FD;border:1px solid #90CAF9;padding:16px 28px;text-align:center;">
          <div style="font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#1565C0;margin-bottom:6px;">Registration OTP</div>
          <div style="font-size:28px;font-weight:700;letter-spacing:0.18em;color:#0B1E5B;font-family:Consolas,'Courier New',monospace;">${otpDisplay}</div>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">Please use this OTP when completing registration in the app. The same OTP applies whether you are onboarding as a <strong>seller partner</strong> or as a <strong>buyer</strong>.</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;"><strong>Timing note:</strong> you may notice a short delay of <strong>up to about one minute</strong> when the app requests or confirms the OTP (or during related steps). If something appears slow, please wait a moment and then <strong>restart the application</strong>—it usually resolves quickly.</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1D24;">If you need help at any point, reach us at <a href="mailto:${escapeHtml(b.supportEmail)}" style="color:#1565C0;">${escapeHtml(b.supportEmail)}</a> or visit <a href="${site}" style="color:#1565C0;font-weight:600;">vybekart.co.in</a>.</p>
    <p style="margin:0;font-size:16px;line-height:1.6;color:#1A1D24;">Thank you for being with us early—we appreciate your patience as we refine the experience.</p>
  `.trim();
}

export function buildOtpRegistrationAnnouncementHtml(
  p: OtpAnnouncementParams,
): string {
  const b = p.branding ?? getVybeKartMailBranding();
  const otp = p.otp ?? DEFAULT_REGISTRATION_OTP;
  const first = firstName(p.name || '');
  return buildVybeKartMailShellHtml({
    branding: b,
    recipientEmail: p.recipientEmail,
    headerBadge: 'Registration',
    headerTitle: 'Complete your VybeKart signup',
    headerSubtitle: `Hi ${first} — use your OTP below`,
    bodyHtml: bodyInnerHtml(b, first, otp),
    whyReceivedHtml: `You are on our early-access list for VybeKart (seller partner or buyer). This email explains how to complete app registration using the shared OTP for this phase.`,
    postLinksHtml:
      'Do not share this OTP with anyone you do not trust. If you did not expect this message, please ignore it and contact support.',
  });
}

export function buildOtpRegistrationAnnouncementText(p: OtpAnnouncementParams): string {
  const b = p.branding ?? getVybeKartMailBranding();
  const otp = p.otp ?? DEFAULT_REGISTRATION_OTP;
  const first = firstName(p.name || '');
  const lines = [
    `Dear ${first},`,
    '',
    'We are writing to our early seller partners and buyers with a quick update about registering on the VybeKart application.',
    '',
    `Registration OTP (use in the app for seller partner or buyer registration): ${otp}`,
    '',
    'Timing note: you may notice a short delay of up to about one minute when the app requests or confirms the OTP (or during related steps). If something appears slow, please wait a moment and then restart the application.',
    '',
    `Support: ${b.supportEmail}`,
    `Website: ${b.websiteUrl}`,
    '',
    'Why you received this: you are on our early-access list for VybeKart.',
    '',
    `Recipient: ${p.recipientEmail}`,
  ];
  return lines.join('\n');
}

function loadEnvFromBackendRoot(): void {
  const backendRoot = path.resolve(__dirname, '../..');
  const envPath = path.join(backendRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

if (require.main === module) {
  loadEnvFromBackendRoot();
  const sample = buildOtpRegistrationAnnouncementHtml({
    name: 'Sample User',
    recipientEmail: 'you@example.com',
  });
  process.stdout.write(sample);
}
