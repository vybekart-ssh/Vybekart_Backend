import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { ReportIssueDto } from './dto/report-issue.dto';
import { SubmitConcernDto } from './dto/submit-concern.dto';
import { AppFeedbackDto } from './dto/app-feedback.dto';

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

  /**
   * In-app feedback (shopper or seller partner): ticket + professional HTML email to account manager.
   */
  async submitAppFeedback(userId: string, dto: AppFeedbackDto) {
    const role: 'buyer' | 'seller' =
      dto.role === 'seller' ? 'seller' : 'buyer';
    const userTopic = dto.subject?.trim() || '';
    const defaultTopic =
      role === 'seller'
        ? 'Seller partner app feedback'
        : 'Shopper app feedback';
    const ticketSubject = userTopic || defaultTopic;
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        subject: ticketSubject,
        message: `[APP_FEEDBACK|${role}]\n${dto.message.trim()}`,
      },
      select: { id: true, subject: true, createdAt: true },
    });

    const contact = this.getAccountManagerContact();
    const toEmail = contact.email?.trim();
    if (!toEmail) {
      console.warn('Support: No SUPPORT_ACCOUNT_MANAGER_EMAIL. Feedback ticket saved but not emailed.');
      return { ...ticket, emailed: false };
    }

    const submittedAt = ticket.createdAt ?? new Date();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        buyerProfile: { select: { id: true } },
        sellerProfile: { select: { id: true, businessName: true } },
      },
    });

    const ticketRef = appFeedbackTicketRef(ticket.id);
    const metaRows =
      role === 'seller'
        ? buildSellerFeedbackMetaRows(user, userId)
        : buildBuyerFeedbackMetaRows(user, userId);

    const { html, text, emailSubject } = buildProfessionalAppFeedbackEmail({
      role,
      ticketId: ticket.id,
      ticketRef,
      topicLine: defaultTopic,
      message: dto.message.trim(),
      metaRows,
      submittedAt,
    });

    const resendKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    const replyTo = user?.email?.trim() || 'noreply@vybekart.com';
    const mailFrom =
      this.config.get<string>('MAIL_FROM') ??
      'VybeKart Support <onboarding@resend.dev>';

    if (resendKey) {
      try {
        await this.sendViaResend(resendKey, {
          from: mailFrom,
          to: toEmail,
          subject: ensureNonEmptySubject(emailSubject, ticketRef, role),
          html,
          text,
          replyTo,
        });
      } catch (err) {
        console.error('Support: failed to send app feedback (Resend)', err);
        return { ...ticket, emailed: false };
      }
      return { ...ticket, emailed: true };
    }

    const mailHost = this.config.get<string>('MAIL_HOST')?.trim();
    if (!mailHost || mailHost.includes('@')) {
      return { ...ticket, emailed: false };
    }

    try {
      const mailPort = this.config.get<number>('MAIL_PORT') ?? 587;
      const transporter = nodemailer.createTransport({
        host: mailHost,
        port: mailPort,
        secure: this.config.get<string>('MAIL_SECURE') === 'true',
        family: 4,
        auth: this.config.get<string>('MAIL_USER')
          ? {
              user: this.config.get<string>('MAIL_USER'),
              pass: this.config.get<string>('MAIL_PASS'),
            }
          : undefined,
      } as any);
      await transporter.sendMail({
        from: mailFrom,
        to: toEmail,
        subject: ensureNonEmptySubject(emailSubject, ticketRef, role),
        text,
        html,
        replyTo,
      });
    } catch (err) {
      console.error('Support: failed to send app feedback (SMTP)', err);
      return { ...ticket, emailed: false };
    }

    return { ...ticket, emailed: true };
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

    const resendKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    if (resendKey) {
      try {
        await this.sendViaResend(resendKey, {
          from: this.config.get<string>('MAIL_FROM') ?? 'VybeKart Support <onboarding@resend.dev>',
          to: toEmail,
          subject: dto.subject,
          html,
          text,
          replyTo: sellerEmail,
        });
      } catch (err) {
        console.error('Support: failed to send concern email (Resend)', err);
      }
      return ticket;
    }

    const mailHost = this.config.get<string>('MAIL_HOST')?.trim();
    if (!mailHost || mailHost.includes('@')) {
      if (mailHost?.includes('@')) {
        console.warn('Support: MAIL_HOST must be the SMTP server hostname (e.g. smtp.gmail.com), not an email. Skipping send.');
      }
      return ticket;
    }

    try {
      const mailPort = this.config.get<number>('MAIL_PORT') ?? 587;
      const transporter = nodemailer.createTransport({
        host: mailHost,
        port: mailPort,
        secure: this.config.get<string>('MAIL_SECURE') === 'true',
        family: 4,
        auth: this.config.get<string>('MAIL_USER')
          ? {
              user: this.config.get<string>('MAIL_USER'),
              pass: this.config.get<string>('MAIL_PASS'),
            }
          : undefined,
      } as any);
      await transporter.sendMail({
        from: sellerEmail,
        to: toEmail,
        subject: dto.subject,
        text,
        html,
        replyTo: sellerEmail,
      });
    } catch (err) {
      console.error('Support: failed to send concern email (SMTP)', err);
    }

    return ticket;
  }

  private async sendViaResend(
    apiKey: string,
    opts: {
      from: string;
      to: string;
      subject: string;
      html: string;
      text: string;
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
        text: opts.text,
        reply_to: opts.replyTo,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API ${res.status}: ${body}`);
    }
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

function appFeedbackTicketRef(ticketId: string): string {
  return ticketId.replace(/-/g, '').slice(0, 10).toUpperCase();
}

type AppFeedbackUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: Date;
  buyerProfile: { id: string } | null;
  sellerProfile: { id: string; businessName: string } | null;
} | null;

function buildBuyerFeedbackMetaRows(
  user: AppFeedbackUser,
  fallbackUserId: string,
): { label: string; value: string }[] {
  if (!user) {
    return [{ label: 'User ID', value: `${fallbackUserId} (record not found)` }];
  }
  return [
    { label: 'Role', value: 'Shopper (buyer app)' },
    { label: 'User ID', value: user.id },
    { label: 'Name', value: user.name ?? '—' },
    { label: 'Email', value: user.email },
    { label: 'Phone', value: user.phone ?? '—' },
    { label: 'Buyer profile', value: user.buyerProfile ? 'Yes' : 'No' },
    { label: 'Registered', value: user.createdAt?.toISOString() ?? '—' },
  ];
}

function buildSellerFeedbackMetaRows(
  user: AppFeedbackUser,
  fallbackUserId: string,
): { label: string; value: string }[] {
  if (!user) {
    return [{ label: 'User ID', value: `${fallbackUserId} (record not found)` }];
  }
  const biz = user.sellerProfile?.businessName ?? '—';
  return [
    { label: 'Role', value: 'Seller partner' },
    { label: 'User ID', value: user.id },
    { label: 'Name', value: user.name ?? '—' },
    { label: 'Email', value: user.email },
    { label: 'Phone', value: user.phone ?? '—' },
    { label: 'Store / business', value: biz },
    { label: 'Seller profile ID', value: user.sellerProfile?.id ?? '—' },
    { label: 'Registered', value: user.createdAt?.toISOString() ?? '—' },
  ];
}

function ensureNonEmptySubject(
  subject: string,
  ticketRef: string,
  role: 'buyer' | 'seller',
): string {
  const s = subject?.trim();
  if (s && s.length > 0) return s;
  const who = role === 'seller' ? 'Seller partner' : 'Shopper';
  return `VybeKart ${who} app feedback | Ref ${ticketRef}`;
}

function buildProfessionalAppFeedbackEmail(params: {
  role: 'buyer' | 'seller';
  ticketId: string;
  ticketRef: string;
  topicLine: string;
  message: string;
  metaRows: { label: string; value: string }[];
  submittedAt: Date;
}): { html: string; text: string; emailSubject: string } {
  const brand = '#1a56c9';
  const headerTitle =
    params.role === 'seller'
      ? 'Seller partner feedback'
      : 'Shopper feedback';
  const preheader =
    params.role === 'seller'
      ? 'A VybeKart seller partner shared feedback from the partner app.'
      : 'A VybeKart shopper shared feedback from the mobile app.';

  const roleWord = params.role === 'seller' ? 'Seller partner' : 'Shopper';
  /** Explicit inbox subject line (always set here; guarded again before SMTP/Resend). */
  const emailSubject = `VybeKart ${roleWord} app feedback | Ref ${params.ticketRef}`;

  const rowsHtml = params.metaRows
    .map(
      (r) =>
        `<tr><td style="padding:10px 14px;border-bottom:1px solid #e8ecf1;font-size:14px;color:#64748b;width:38%;vertical-align:top;">${escapeHtml(r.label)}</td><td style="padding:10px 14px;border-bottom:1px solid #e8ecf1;font-size:14px;color:#0f172a;font-weight:500;vertical-align:top;">${escapeHtml(r.value)}</td></tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(headerTitle)}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <span style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:${brand};padding:20px 24px;">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.9);">VybeKart · In-app feedback</p>
              <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.25;">${escapeHtml(headerTitle)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 24px 8px;">
              <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.55;">The following was submitted through the VybeKart mobile app. You can reply directly to reach the submitter.</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;margin-bottom:20px;border:1px solid #e2e8f0;">
                <tr>
                  <td style="padding:14px 18px;">
                    <p style="margin:0 0 4px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Reference</p>
                    <p style="margin:0;font-size:18px;font-weight:700;color:${brand};letter-spacing:0.04em;">${escapeHtml(params.ticketRef)}</p>
                    <p style="margin:8px 0 0;font-size:12px;color:#94a3b8;">Full ticket ID: <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px;font-size:11px;">${escapeHtml(params.ticketId)}</code></p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Category</p>
              <p style="margin:0 0 20px;font-size:16px;color:#0f172a;font-weight:600;">${escapeHtml(params.topicLine)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px;">
              <p style="margin:0 0 10px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Submitter details</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:22px;">
                ${rowsHtml}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;">
              <p style="margin:0 0 10px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Message</p>
              <div style="padding:16px 18px;background:#fafbfc;border-left:4px solid ${brand};border-radius:0 8px 8px 0;font-size:15px;color:#1e293b;line-height:1.6;white-space:pre-wrap;">${escapeHtml(params.message)}</div>
              <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;">Submitted ${escapeHtml(params.submittedAt.toISOString())} · Reply-To is the submitter’s email when available.</p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;max-width:560px;">Automated message from VybeKart support systems.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textMeta = params.metaRows.map((r) => `${r.label}: ${r.value}`).join('\n');
  const text = [
    `VybeKart — ${headerTitle}`,
    '',
    preheader,
    '',
    `Reference: ${params.ticketRef}`,
    `Ticket ID: ${params.ticketId}`,
    `Category: ${params.topicLine}`,
    '',
    '--- Submitter ---',
    textMeta,
    '',
    '--- Message ---',
    params.message,
    '',
    `Submitted: ${params.submittedAt.toISOString()}`,
  ].join('\n');

  return { html, text, emailSubject };
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
