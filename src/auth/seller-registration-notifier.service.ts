import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { RegisterSellerDto } from './dto/auth.dto';

@Injectable()
export class SellerRegistrationNotifierService {
  private readonly logger = new Logger(SellerRegistrationNotifierService.name);

  constructor(private config: ConfigService) {}

  async notifyNewSellerApplication(
    dto: RegisterSellerDto,
    categoryNames: string[],
  ): Promise<void> {
    const to =
      this.config.get<string>('SELLER_REGISTRATION_NOTIFY_EMAIL')?.trim() ||
      'vybekart88@gmail.com';
    const subject = `New seller registration — ${dto.businessName.trim()}`;
    const { html, text } = buildSellerRegistrationEmail(dto, categoryNames);

    const resendKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    if (resendKey) {
      try {
        await this.sendViaResend(resendKey, {
          from:
            this.config.get<string>('MAIL_FROM') ??
            'VybeKart <onboarding@resend.dev>',
          to,
          subject,
          html,
          replyTo: dto.email.trim(),
        });
        return;
      } catch (err) {
        this.logger.error('Resend failed for seller registration email', err);
      }
    }

    const mailHost = this.config.get<string>('MAIL_HOST')?.trim();
    if (!mailHost || mailHost.includes('@')) {
      this.logger.warn(
        'Seller registration email skipped: configure RESEND_API_KEY or MAIL_HOST',
      );
      return;
    }

    try {
      const mailPort = this.config.get<number>('MAIL_PORT') ?? 587;
      const transporter = nodemailer.createTransport({
        // IMPORTANT: keep hostname here so TLS can validate the server certificate
        // (connecting via a resolved IP breaks cert altname checks for e.g. smtp.gmail.com).
        host: mailHost,
        port: mailPort,
        secure: this.config.get<string>('MAIL_SECURE') === 'true',
        family: 4,
        tls: {
          // Ensure SNI / hostname verification uses the SMTP hostname
          servername: mailHost,
        },
        auth: this.config.get<string>('MAIL_USER')
          ? {
              user: this.config.get<string>('MAIL_USER'),
              pass: this.config.get<string>('MAIL_PASS'),
            }
          : undefined,
      } as any);
      await transporter.sendMail({
        from: dto.email.trim(),
        to,
        subject,
        text,
        html,
        replyTo: dto.email.trim(),
      });
    } catch (err) {
      this.logger.error('SMTP failed for seller registration email', err);
    }
  }

  private async sendViaResend(
    apiKey: string,
    opts: {
      from: string;
      to: string;
      subject: string;
      html: string;
      replyTo: string;
    },
  ): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: opts.from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        reply_to: opts.replyTo,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API ${res.status}: ${body}`);
    }
  }
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;width:200px;vertical-align:top;"><strong>${escapeHtml(label)}</strong></td><td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;white-space:pre-wrap;">${escapeHtml(value)}</td></tr>`;
}

function buildSellerRegistrationEmail(
  dto: RegisterSellerDto,
  categoryNames: string[],
): { html: string; text: string } {
  const pickup = dto.pickupAddress;
  const pickupBlock = pickup
    ? [
        `Line 1: ${pickup.line1}`,
        pickup.line2 ? `Line 2: ${pickup.line2}` : '',
        `City: ${pickup.city}`,
        `State: ${pickup.state}`,
        `PIN: ${pickup.zip}`,
      ]
        .filter(Boolean)
        .join('\n')
    : '—';

  const categories =
    categoryNames.length > 0 ? categoryNames.join(', ') : '—';

  const lines: [string, string][] = [
    ['Section', 'Create account & identity'],
    ['Full name', dto.name],
    ['Email', dto.email],
    ['Phone', dto.phone],
    ['Password', '•••••••• (submitted; not stored in email)'],
    ['', ''],
    ['Section', 'Step 1–2 — Business & store'],
    ['Business / store name', dto.businessName],
    ['GST number', dto.gstNumber?.trim() || '—'],
    ['Store description', dto.description?.trim() || '—'],
    ['Categories', categories],
    ['', ''],
    ['Section', 'Step 3 — Pickup address'],
    ['Pickup address', pickupBlock],
    ['', ''],
    ['Section', 'Step 4 — Banking'],
    ['Bank name', dto.bankName?.trim() || '—'],
    ['Account holder name', dto.accountHolderName?.trim() || '—'],
    ['Account type', dto.accountType?.trim() || '—'],
    ['Bank account', dto.bankAccount?.trim() || '—'],
    ['IFSC', dto.ifscCode?.trim() || '—'],
  ];

  const tableRows = lines
    .filter(([a, b]) => a !== '' || b !== '')
    .map(([label, value]) => (label ? row(label, value) : ''))
    .join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;font-family:'Segoe UI',Tahoma,sans-serif;font-size:14px;background:#f0f4f8;color:#1a1d24;">
  <div style="max-width:640px;margin:0 auto;padding:24px;background:#fff;">
    <h1 style="color:#1e88e5;margin:0 0 8px;">New seller partner registration</h1>
    <p style="margin:0 0 20px;color:#64748b;">A seller completed the full onboarding flow (create account through bank details). Please review in the master console within ~24 hours.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e2e8f0;">${tableRows}</table>
    <p style="margin:24px 0 0;color:#64748b;">— VybeKart system notification</p>
  </div>
</body></html>`;

  const text = lines
    .map(([l, v]) => (l && v ? `${l}: ${v}` : v))
    .filter(Boolean)
    .join('\n');

  return { html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
