import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { sanitizeReplyTo } from '../mail/mail-from';
import { RegisterSellerDto } from './dto/auth.dto';

@Injectable()
export class SellerRegistrationNotifierService {
  private readonly logger = new Logger(SellerRegistrationNotifierService.name);

  constructor(
    private config: ConfigService,
    private mail: MailService,
  ) {}

  async notifyNewSellerApplication(
    dto: RegisterSellerDto,
    categoryNames: string[],
  ): Promise<void> {
    const to =
      this.config.get<string>('SELLER_REGISTRATION_NOTIFY_EMAIL')?.trim() ||
      'vybekart88@gmail.com';
    const subject = `New seller registration — ${dto.businessName.trim()}`;
    const { html, text } = buildSellerRegistrationEmail(dto, categoryNames);

    try {
      await this.mail.send({
        from: this.mail.opsFrom(),
        to,
        subject,
        html,
        text,
        replyTo: sanitizeReplyTo(dto.email),
      });
    } catch (err) {
      this.logger.error('Failed to send seller registration email', err);
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

  const fullName =
    [dto.firstName, dto.middleName, dto.lastName].filter(Boolean).join(' ') ||
    dto.name ||
    '—';

  const lines: [string, string][] = [
    ['Section', 'Create account & identity'],
    ['Full name', fullName],
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
