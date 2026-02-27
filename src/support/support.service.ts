import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { ReportIssueDto } from './dto/report-issue.dto';
import { SubmitConcernDto } from './dto/submit-concern.dto';

export interface AccountManagerContact {
  name: string;
  phone: string;
  email: string;
}

export interface EscalationLevel {
  level: number;
  title: string;
  description: string;
  contactName: string;
  contactEmail: string;
}

@Injectable()
export class SupportService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async getFaqs() {
    return this.prisma.faq.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, question: true, answer: true },
    });
  }

  getAccountManagerContact(): AccountManagerContact {
    const name =
      this.config.get<string>('SUPPORT_ACCOUNT_MANAGER_NAME') ?? 'Support Team';
    const phone =
      this.config.get<string>('SUPPORT_ACCOUNT_MANAGER_PHONE') ?? '';
    const email =
      this.config.get<string>('SUPPORT_ACCOUNT_MANAGER_EMAIL') ??
      'support@vybekart.com';
    return { name, phone, email };
  }

  getEscalationLevels(): EscalationLevel[] {
    const raw =
      this.config.get<string>('SUPPORT_ESCALATION_LEVELS_JSON') ?? defaultEscalationJson();
    try {
      const parsed = JSON.parse(raw) as EscalationLevel[];
      return Array.isArray(parsed) ? parsed : defaultEscalationLevels();
    } catch {
      return defaultEscalationLevels();
    }
  }

  async reportIssue(userId: string, dto: ReportIssueDto) {
    return this.prisma.supportTicket.create({
      data: {
        userId,
        subject: dto.subject,
        message: dto.message,
      },
      select: { id: true, subject: true, createdAt: true },
    });
  }

  async submitConcern(userId: string, dto: SubmitConcernDto) {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        subject: dto.subject,
        message: dto.message,
      },
      select: { id: true, subject: true, createdAt: true },
    });

    const mailHost = this.config.get<string>('MAIL_HOST')?.trim();
    if (!mailHost || mailHost.includes('@')) {
      if (mailHost?.includes('@')) {
        console.warn('Support: MAIL_HOST must be the SMTP server hostname (e.g. smtp.gmail.com), not an email address. Skipping send.');
      }
      return ticket;
    }

    const toEmail = dto.toEmail?.trim();
    if (!toEmail) {
      console.warn('Support: No recipient email (toEmail) provided. Skipping send.');
      return ticket;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        sellerProfile: {
          select: {
            id: true,
            businessName: true,
            businessAddress: true,
            gstNumber: true,
            description: true,
            status: true,
          },
        },
      },
    });

    const sellerEmail = user?.email;
    if (!sellerEmail) return ticket;

    const { html, text } = buildConcernEmailTemplate({
      recipientTitle: dto.toName,
      subject: dto.subject,
      concernMessage: dto.message,
      escalationLevel: dto.escalationLevel,
      ticketId: ticket.id,
      user: user!,
    });

    try {
      const transporter = nodemailer.createTransport({
        host: this.config.get<string>('MAIL_HOST'),
        port: this.config.get<number>('MAIL_PORT') ?? 587,
        secure: this.config.get<string>('MAIL_SECURE') === 'true',
        family: 4, // Force IPv4 (avoids ENETUNREACH on IPv6-only resolution e.g. on Render)
        auth: this.config.get<string>('MAIL_USER')
          ? {
              user: this.config.get<string>('MAIL_USER'),
              pass: this.config.get<string>('MAIL_PASS'),
            }
          : undefined,
      });
      await transporter.sendMail({
        from: sellerEmail,
        to: toEmail,
        subject: dto.subject,
        text,
        html,
        replyTo: sellerEmail,
      });
    } catch (err) {
      console.error('Support: failed to send concern email', err);
    }

    return ticket;
  }
}

interface SellerDetailForEmail {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: Date;
  sellerProfile: {
    id: string;
    businessName: string;
    businessAddress: string | null;
    gstNumber: string | null;
    description: string | null;
    status: string;
  } | null;
}

function buildConcernEmailTemplate(params: {
  recipientTitle: string;
  subject: string;
  concernMessage: string;
  escalationLevel?: string;
  ticketId: string;
  user: SellerDetailForEmail;
}): { html: string; text: string } {
  const { recipientTitle, subject, concernMessage, escalationLevel, ticketId, user } = params;
  const seller = user.sellerProfile;
  const sellerName = user.name || 'Seller';
  const businessName = seller?.businessName || '—';
  const businessAddress = seller?.businessAddress || '—';
  const gstNumber = seller?.gstNumber || '—';
  const phone = user.phone || '—';
  const registeredAt = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '—';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 14px; line-height: 1.6; color: #333; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; padding: 24px; background-color: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
    <p style="margin: 0 0 20px;">Dear ${escapeHtml(recipientTitle)},</p>
    <p style="margin: 0 0 16px;">I am writing to bring to your kind attention the following concern submitted through the VybeKart seller support escalation channel.</p>
    ${escalationLevel ? `<p style="margin: 0 0 16px;"><strong>Escalation level:</strong> ${escapeHtml(escalationLevel)}</p>` : ''}
    <p style="margin: 0 0 8px;"><strong>Reference:</strong> Ticket #${escapeHtml(ticketId)}</p>
    <p style="margin: 0 0 20px;"><strong>Subject:</strong> ${escapeHtml(subject)}</p>

    <table style="width: 100%; border-collapse: collapse; margin: 0 0 24px; font-size: 13px; background-color: #f9f9f9; border: 1px solid #e0e0e0;">
      <caption style="text-align: left; padding: 10px 12px; font-weight: bold; background-color: #e8e8e8;">Seller details</caption>
      <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0; width: 140px;"><strong>Name</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0;">${escapeHtml(sellerName)}</td></tr>
      <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0;"><strong>Email</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0;">${escapeHtml(user.email)}</td></tr>
      <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0;"><strong>Phone</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0;">${escapeHtml(phone)}</td></tr>
      <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0;"><strong>Business name</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0;">${escapeHtml(businessName)}</td></tr>
      <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0;"><strong>Business address</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0;">${escapeHtml(businessAddress)}</td></tr>
      <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0;"><strong>GST number</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0;">${escapeHtml(gstNumber)}</td></tr>
      <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0;"><strong>Registered on</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0;">${escapeHtml(registeredAt)}</td></tr>
      <tr><td style="padding: 8px 12px;"><strong>User ID</strong></td><td style="padding: 8px 12px;">${escapeHtml(user.id)}</td></tr>
    </table>

    <p style="margin: 0 0 8px;"><strong>Concern / message:</strong></p>
    <div style="margin: 0 0 24px; padding: 12px; background-color: #fafafa; border-left: 4px solid #3A86FF; white-space: pre-wrap;">${escapeHtml(concernMessage)}</div>

    <p style="margin: 0 0 8px;">I request you to look into the matter at the earliest. Please reply to this email for any further information.</p>
    <p style="margin: 24px 0 0;">Yours sincerely,<br><strong>${escapeHtml(sellerName)}</strong><br>${escapeHtml(user.email)}</p>
  </div>
</body>
</html>`;

  const text = [
    `Dear ${recipientTitle},`,
    '',
    'I am writing to bring to your kind attention the following concern submitted through the VybeKart seller support escalation channel.',
    escalationLevel ? `Escalation level: ${escalationLevel}` : '',
    `Reference: Ticket #${ticketId}`,
    `Subject: ${subject}`,
    '',
    '--- SELLER DETAILS ---',
    `Name: ${sellerName}`,
    `Email: ${user.email}`,
    `Phone: ${phone}`,
    `Business name: ${businessName}`,
    `Business address: ${businessAddress}`,
    `GST number: ${gstNumber}`,
    `Registered on: ${registeredAt}`,
    `User ID: ${user.id}`,
    '',
    '--- CONCERN / MESSAGE ---',
    concernMessage,
    '',
    'I request you to look into the matter at the earliest. Please reply to this email for any further information.',
    '',
    `Yours sincerely,`,
    sellerName,
    user.email,
  ]
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

function defaultEscalationJson(): string {
  return JSON.stringify(defaultEscalationLevels());
}

function defaultEscalationLevels(): EscalationLevel[] {
  return [
    {
      level: 1,
      title: 'Zonal head',
      description:
        "The Zonal head is in charge of a zone's relationships and growth, and should be able to respond to your concerns quickly.",
      contactName: 'Zonal head',
      contactEmail: 'zonal@vybekart.com',
    },
    {
      level: 2,
      title: 'City CEO',
      description:
        'If your concern is still unresolved, highlight it to the City CEO.',
      contactName: 'City CEO',
      contactEmail: 'city-ceo@vybekart.com',
    },
    {
      level: 3,
      title: 'Vybekart',
      description:
        'If your concern is still unresolved, highlight it to Vybekart.',
      contactName: 'Vybekart',
      contactEmail: 'support@vybekart.com',
    },
  ];
}
