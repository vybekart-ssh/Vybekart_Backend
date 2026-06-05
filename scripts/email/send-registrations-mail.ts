/**
 * One command for bulk mail from registrations CSV (Resend).
 *
 *   OTP / registration notice:
 *     npx ts-node --transpile-only scripts/email/send-registrations-mail.ts --mail otp
 *
 *   Alpha APK invite (same as legacy send-alpha-invites):
 *     npx ts-node --transpile-only scripts/email/send-registrations-mail.ts --mail alpha
 *
 * Env (see scripts/alpha-invite/config.example.env):
 *   RESEND_API_KEY, MAIL_FROM, REGISTRATIONS_CSV, DRY_RUN=true, ALPHA_SEND_DELAY_MS, etc.
 *
 * Schedule delivery — IST only (Resend queues each recipient separately):
 *   RESEND_SCHEDULED_AT="tomorrow at 4pm IST"
 *   RESEND_SCHEDULED_AT="2026-04-18T16:00:00+05:30"   (same moment, ISO 8601 = IST)
 *
 * Pick template only — same CSV, same dedupe by email:
 *   REGISTRATIONS_MAIL=otp   (alternative to --mail otp)
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  alphaInviteSubjectFor,
  buildAlphaInviteHtml,
  buildAlphaInviteText,
  getAlphaInviteBranding,
  verifyAlphaLogoUrlIfSet,
} from '../alpha-invite/alpha-invite-mail';
import {
  buildOtpRegistrationAnnouncementHtml,
  buildOtpRegistrationAnnouncementText,
  OTP_REGISTRATION_ANNOUNCEMENT_SUBJECT,
} from './otp-registration-announcement';
import {
  dedupeRegistrationRows,
  loadBackendDotEnv,
  parseCsv,
} from './registrations-csv';
import { getVybeKartMailBranding } from './vybekart-email-layout';

export type RegistrationsMailKind = 'alpha' | 'otp';

function parseMailKindFromArgv(argv: string[]): RegistrationsMailKind | null {
  const joined = argv.join(' ').toLowerCase();
  if (argv.includes('--mail') || argv.includes('-m')) {
    const i = Math.max(argv.indexOf('--mail'), argv.indexOf('-m'));
    const v = (argv[i + 1] || '').toLowerCase();
    if (v === 'alpha' || v === 'apk' || v === 'invite') return 'alpha';
    if (v === 'otp' || v === 'registration') return 'otp';
  }
  if (argv.includes('--alpha') || argv.includes('--apk')) return 'alpha';
  if (argv.includes('--otp')) return 'otp';
  const env = (process.env.REGISTRATIONS_MAIL || '').trim().toLowerCase();
  if (env === 'alpha' || env === 'apk' || env === 'invite') return 'alpha';
  if (env === 'otp' || env === 'registration') return 'otp';
  if (joined.includes('help') || argv.includes('-h') || argv.includes('--help'))
    return null;
  return null;
}

async function sendViaResend(
  apiKey: string,
  opts: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    replyTo: string;
    /** Resend: natural language with IST, or ISO +05:30. Omit = send immediately. */
    scheduledAt?: string;
  },
): Promise<string> {
  const body: Record<string, unknown> = {
    from: opts.from,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    reply_to: opts.replyTo,
  };
  if (opts.scheduledAt?.trim()) {
    body.scheduled_at = opts.scheduledAt.trim();
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Resend API ${res.status}: ${bodyText}`);
  }
  try {
    const j = JSON.parse(bodyText) as { id?: string };
    return j.id || bodyText;
  } catch {
    return bodyText;
  }
}

export interface RunSendRegistrationsMailOptions {
  mailKind: RegistrationsMailKind;
  argv?: string[];
}

function resolveDefaultRegistrationsCsvPath(): string {
  const besideAlpha = path.join(__dirname, '../alpha-invite/registrations.csv');
  const backendRoot = path.resolve(__dirname, '../..');
  const atRepoRoot = path.join(backendRoot, 'registrations.csv');
  if (fs.existsSync(besideAlpha)) return besideAlpha;
  if (fs.existsSync(atRepoRoot)) return atRepoRoot;
  return besideAlpha;
}

export async function runSendRegistrationsMail(
  opts: RunSendRegistrationsMailOptions,
): Promise<void> {
  const argv = opts.argv ?? process.argv;
  const mailKind = opts.mailKind;

  const rawCsv =
    process.env.REGISTRATIONS_CSV?.trim() || resolveDefaultRegistrationsCsvPath();
  const csvPath = path.isAbsolute(rawCsv)
    ? rawCsv
    : path.join(process.cwd(), rawCsv);
  const dryRun =
    String(process.env.DRY_RUN || '').toLowerCase() === 'true' ||
    argv.includes('--dry-run');

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const mailFrom =
    process.env.MAIL_FROM?.trim() || 'Vybekart <noreply@vybekart.co.in>';

  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found:', csvPath);
    console.error('Set REGISTRATIONS_CSV to your file (columns: email, name, registration_type, …).');
    process.exit(1);
  }

  if (!dryRun && !apiKey) {
    console.error('Missing RESEND_API_KEY in environment or .env');
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, 'utf8');
  const records = parseCsv(raw);
  const rows = dedupeRegistrationRows(records);

  const alphaBranding = getAlphaInviteBranding();
  const mailBranding = getVybeKartMailBranding();

  if (mailKind === 'alpha') {
    if (!alphaBranding.logoUrl) {
      console.warn(
        'ALPHA_LOGO_URL is not set — email header will be text-only. Add it to .env (see scripts/alpha-invite/config.example.env).',
      );
    }
  } else if (!mailBranding.logoUrl) {
    console.warn(
      'ALPHA_LOGO_URL is not set — OTP email header will be text-only.',
    );
  }

  console.log(`Template: ${mailKind} | Recipients (deduped): ${rows.length}`);
  if (rows.length === 0) {
    process.exit(0);
  }

  if (mailKind === 'alpha') {
    await verifyAlphaLogoUrlIfSet(alphaBranding.logoUrl);
  }

  const delayMs = Math.max(
    0,
    parseInt(process.env.ALPHA_SEND_DELAY_MS || '700', 10) || 700,
  );
  const logSuffix = mailKind === 'alpha' ? 'alpha' : 'otp';
  const logPath =
    process.env.REGISTRATIONS_SEND_LOG ||
    path.join(__dirname, `registrations-send-log-${logSuffix}-${Date.now()}.jsonl`);

  const otpReplyTo =
    process.env.ALPHA_REPLY_TO?.trim() || mailBranding.supportEmail;

  const resendScheduledAt = (process.env.RESEND_SCHEDULED_AT || '').trim();
  if (resendScheduledAt) {
    console.log(`Resend scheduled_at: ${resendScheduledAt}`);
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let html: string;
    let text: string;
    let subject: string;
    let replyTo: string;

    if (mailKind === 'alpha') {
      html = buildAlphaInviteHtml(row, alphaBranding);
      text = buildAlphaInviteText(row, alphaBranding);
      subject = alphaInviteSubjectFor(row);
      replyTo = alphaBranding.replyTo;
    } else {
      html = buildOtpRegistrationAnnouncementHtml({
        name: row.name,
        recipientEmail: row.email,
        branding: mailBranding,
      });
      text = buildOtpRegistrationAnnouncementText({
        name: row.name,
        recipientEmail: row.email,
        branding: mailBranding,
      });
      subject = OTP_REGISTRATION_ANNOUNCEMENT_SUBJECT;
      replyTo = otpReplyTo;
    }

    if (dryRun) {
      const sched = resendScheduledAt ? ` | scheduled_at=${resendScheduledAt}` : '';
      console.log(`[DRY_RUN] ${row.email} | ${subject}${sched}`);
      if (i === 0) {
        console.log('--- text preview ---\n', text.slice(0, 900), '\n---');
      }
      continue;
    }

    try {
      const id = await sendViaResend(apiKey!, {
        from: mailFrom,
        to: row.email,
        subject,
        html,
        text,
        replyTo,
        scheduledAt: resendScheduledAt || undefined,
      });
      fs.appendFileSync(
        logPath,
        JSON.stringify({
          ok: true,
          mailKind,
          email: row.email,
          resendId: id,
          at: new Date().toISOString(),
          ...(resendScheduledAt ? { scheduled_at: resendScheduledAt } : {}),
        }) + '\n',
      );
      console.log(`OK ${i + 1}/${rows.length} ${row.email} ${id}`);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      fs.appendFileSync(
        logPath,
        JSON.stringify({
          ok: false,
          mailKind,
          email: row.email,
          error: err,
          at: new Date().toISOString(),
        }) + '\n',
      );
      console.error(`FAIL ${row.email}: ${err}`);
    }

    if (i < rows.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (!dryRun) console.log('Log file:', logPath);
}

function printHelp(): void {
  console.log(`
VybeKart — send mail from registrations CSV (Resend)

  npx ts-node --transpile-only scripts/email/send-registrations-mail.ts --mail otp
  npx ts-node --transpile-only scripts/email/send-registrations-mail.ts --mail alpha

  DRY_RUN=true   — log only, no sends
  REGISTRATIONS_CSV — path to CSV (if unset: scripts/alpha-invite/registrations.csv when present, else ./registrations.csv at repo root)
  RESEND_SCHEDULED_AT — optional; IST only, e.g. "tomorrow at 4pm IST" or "2026-04-18T16:00:00+05:30"

Or set REGISTRATIONS_MAIL=otp or REGISTRATIONS_MAIL=alpha instead of --mail.
`);
}

async function main(): Promise<void> {
  loadBackendDotEnv();
  const kind = parseMailKindFromArgv(process.argv);
  if (!kind) {
    printHelp();
    process.exit(kind === null && process.argv.some((a) => /help|-h/.test(a)) ? 0 : 1);
  }
  await runSendRegistrationsMail({ mailKind: kind });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
