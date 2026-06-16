import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { VYBEKART_BRAND_NAME } from '../mail/templates/vybekart-email-layout';
import { resolvePublicBaseUrl } from '../common/utils/public-base-url';
import {
  SellerInterestPayload,
  verifySellerInterest,
} from './seller-outreach-interest.util';

@Injectable()
export class SellerOutreachService {
  private readonly logger = new Logger(SellerOutreachService.name);
  private readonly recent = new Map<string, number>();
  private static readonly DEDUPE_MS = 6 * 60 * 60 * 1000;

  constructor(
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  private interestSecret(): string {
    return (
      this.config.get<string>('SELLER_OUTREACH_INTEREST_SECRET')?.trim() ||
      this.config.get<string>('JWT_SECRET')?.trim() ||
      ''
    );
  }

  private notifyTo(): string {
    return (
      this.config.get<string>('SELLER_OUTREACH_INTEREST_TO')?.trim() ||
      this.config.get<string>('CEO_EMAIL')?.trim() ||
      this.config.get<string>('SUPPORT_EMAIL')?.trim() ||
      'ceo@vybekart.co.in'
    );
  }

  private dedupeKey(p: SellerInterestPayload): string {
    return `${p.email}|${p.store}`;
  }

  private shouldNotify(p: SellerInterestPayload): boolean {
    const key = this.dedupeKey(p);
    const now = Date.now();
    const last = this.recent.get(key);
    if (last && now - last < SellerOutreachService.DEDUPE_MS) {
      return false;
    }
    this.recent.set(key, now);
    return true;
  }

  async handleInterestClick(
    payload: SellerInterestPayload,
    sig: string,
  ): Promise<{ ok: boolean; message: string }> {
    const secret = this.interestSecret();
    if (!verifySellerInterest(payload, sig, secret)) {
      return { ok: false, message: 'Invalid or expired link.' };
    }

    const notify = this.shouldNotify(payload);

    if (notify) {
      try {
        await this.mail.send({
          to: this.notifyTo(),
          from: this.config.get<string>('SELLER_OUTREACH_FROM')?.trim(),
          subject: `Seller interest: ${payload.store}`,
          text: [
            `${payload.contact} (${payload.email}) is interested in the ${VYBEKART_BRAND_NAME} seller partner program.`,
            '',
            `Store: ${payload.store}`,
            `Contact: ${payload.contact}`,
            `Email: ${payload.email}`,
            '',
            'They clicked "I\'m Interested" in the outreach email.',
          ].join('\n'),
          html: `
            <p><strong>${payload.contact}</strong> (${payload.email}) is interested in the ${VYBEKART_BRAND_NAME} seller partner program.</p>
            <ul>
              <li><strong>Store:</strong> ${payload.store}</li>
              <li><strong>Contact:</strong> ${payload.contact}</li>
              <li><strong>Email:</strong> ${payload.email}</li>
            </ul>
            <p>They clicked <strong>I'm Interested</strong> in the outreach email.</p>
          `.trim(),
        });

        await this.mail.sendTransactional(payload.email, {
          subject: `We received your interest — ${VYBEKART_BRAND_NAME} seller partners`,
          text: [
            `Hi ${payload.contact},`,
            '',
            `Thank you for your interest in joining ${VYBEKART_BRAND_NAME} as a seller partner.`,
            'Our team has received your response and will reach out to you shortly with next steps.',
            '',
            `In the meantime, you can download the ${VYBEKART_BRAND_NAME} app and keep your store name, address, and contact number handy.`,
            '',
            `— Team ${VYBEKART_BRAND_NAME}`,
          ].join('\n'),
          html: `
            <p>Hi <strong>${payload.contact}</strong>,</p>
            <p>Thank you for your interest in joining <strong>${VYBEKART_BRAND_NAME}</strong> as a seller partner.</p>
            <p>Our team has received your response and will reach out to you shortly with next steps.</p>
            <p style="color:#64748B;font-size:14px;">In the meantime, you can download the ${VYBEKART_BRAND_NAME} app and keep your store name, address, and contact number handy.</p>
            <p>— Team ${VYBEKART_BRAND_NAME}</p>
          `.trim(),
        });
      } catch (err) {
        this.logger.error('Failed to send seller interest emails', err);
        return {
          ok: false,
          message: 'We could not record your interest right now. Please email us directly.',
        };
      }
    }

    return {
      ok: true,
      message: notify
        ? 'Thank you! We have received your interest and sent you a confirmation email.'
        : 'Thank you! We already have your interest on file. Our team will be in touch soon.',
    };
  }

  resolveApiBaseUrl(): string {
    return resolvePublicBaseUrl(this.config);
  }
}
