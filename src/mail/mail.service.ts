import { Injectable, Logger } from '@nestjs/common';
import { resendFetch } from '../common/utils/resend-fetch';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import {
  MAIL_DEFAULTS,
  formatMailFrom,
  sanitizeReplyTo,
} from './mail-from';

type SendEmailInput = {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  replyTo?: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  /** Buyer-facing contact From (verified domain only). */
  supportFrom(): string {
    return formatMailFrom(
      this.config.get<string>('CONTACT_EMAIL') ||
        this.config.get<string>('MAIL_FROM'),
      'Vybekart',
      MAIL_DEFAULTS.contact,
    );
  }

  /** Ops / support-inbox From. */
  opsFrom(): string {
    return formatMailFrom(
      this.config.get<string>('SUPPORT_EMAIL') ||
        this.config.get<string>('MAIL_FROM'),
      'Vybekart Support',
      MAIL_DEFAULTS.support,
    );
  }

  /** Transactional mail (orders, receipts). */
  noreplyFrom(): string {
    return formatMailFrom(
      this.config.get<string>('NOREPLY_EMAIL'),
      'Vybekart',
      MAIL_DEFAULTS.noreply,
    );
  }

  /**
   * Default MAIL_FROM for legacy call sites — never resend.dev.
   * Prefer supportFrom / opsFrom / noreplyFrom for new code.
   */
  defaultFrom(): string {
    return formatMailFrom(
      this.config.get<string>('MAIL_FROM'),
      'Vybekart',
      MAIL_DEFAULTS.contact,
    );
  }

  async sendToSupport(input: Omit<SendEmailInput, 'from' | 'to'>): Promise<void> {
    const to =
      this.config.get<string>('SUPPORT_EMAIL')?.trim() ||
      MAIL_DEFAULTS.support;
    await this.send({ ...input, to, from: this.opsFrom() });
  }

  async sendToBuyer(
    buyerEmail: string,
    input: Omit<SendEmailInput, 'from' | 'to'>,
  ): Promise<void> {
    await this.send({
      ...input,
      to: buyerEmail,
      from: this.supportFrom(),
    });
  }

  async sendTransactional(
    to: string,
    input: Omit<SendEmailInput, 'from' | 'to'>,
  ): Promise<void> {
    await this.send({
      ...input,
      to,
      from: this.noreplyFrom(),
    });
  }

  async send(input: SendEmailInput): Promise<void> {
    const resendKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    const from = input.from ?? this.supportFrom();
    const replyTo = sanitizeReplyTo(input.replyTo);

    if (resendKey) {
      await this.sendViaResend(resendKey, { ...input, from, replyTo });
      return;
    }

    const mailHost = this.config.get<string>('MAIL_HOST')?.trim();
    if (!mailHost || mailHost.includes('@')) {
      this.logger.warn(
        `Email not sent (no RESEND_API_KEY / MAIL_HOST): ${input.subject}`,
      );
      return;
    }

    const mailPort = this.config.get<number>('MAIL_PORT') ?? 587;
    const transporter = nodemailer.createTransport({
      host: mailHost,
      port: mailPort,
      secure: this.config.get<string>('MAIL_SECURE') === 'true',
      family: 4,
      tls: { servername: mailHost },
      auth: this.config.get<string>('MAIL_USER')
        ? {
            user: this.config.get<string>('MAIL_USER'),
            pass: this.config.get<string>('MAIL_PASS'),
          }
        : undefined,
    } as nodemailer.TransportOptions);

    await transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      replyTo,
    });
  }

  private async sendViaResend(
    resendKey: string,
    input: SendEmailInput & { from: string; replyTo?: string },
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      from: input.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    };
    if (input.replyTo) {
      payload.reply_to = input.replyTo;
    }

    const res = await resendFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API ${res.status}: ${body}`);
    }
  }
}
