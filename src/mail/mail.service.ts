import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

type SendEmailInput = {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  from?: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  private supportFrom(): string {
    return (
      this.config.get<string>('CONTACT_EMAIL')?.trim() ||
      this.config.get<string>('MAIL_FROM')?.trim() ||
      'VybeKart <contact@vybekart.co.in>'
    );
  }

  private opsFrom(): string {
    return (
      this.config.get<string>('SUPPORT_EMAIL')?.trim() ||
      this.config.get<string>('MAIL_FROM')?.trim() ||
      'VybeKart Support <support@vybekart.co.in>'
    );
  }

  async sendToSupport(input: Omit<SendEmailInput, 'from' | 'to'>): Promise<void> {
    const to =
      this.config.get<string>('SUPPORT_EMAIL')?.trim() ||
      'support@vybekart.co.in';
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

  async send(input: SendEmailInput): Promise<void> {
    const resendKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    const from = input.from ?? this.supportFrom();

    if (resendKey) {
      await this.sendViaResend(resendKey, { ...input, from });
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
    });
  }

  private async sendViaResend(
    resendKey: string,
    input: SendEmailInput & { from: string },
  ): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API ${res.status}: ${body}`);
    }
  }
}
