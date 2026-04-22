import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';

type ReportUserRow = {
  id: string;
  email: string;
  phone: string | null;
  name: string;
  isActive: boolean;
  roles: string[];
  createdAt: Date;
  updatedAt: Date;
};

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatRoleArray(roles: string[]): string {
  return roles.join('|');
}

function isTruthyFlag(v: string | undefined): boolean {
  const t = (v ?? '').trim().toLowerCase();
  return t === 'true' || t === '1' || t === 'yes';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class DailyUsersReportService {
  private readonly logger = new Logger(DailyUsersReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 0 22 * * *', { timeZone: 'Asia/Kolkata' })
  async sendDailyUsersReport(): Promise<void> {
    const enabled = isTruthyFlag(
      this.config.get<string>('DAILY_USERS_REPORT_ENABLED') ?? 'true',
    );
    if (!enabled) return;

    const to =
      this.config.get<string>('DAILY_USERS_REPORT_TO')?.trim() ||
      'vybekart88@gmail.com';

    // Requested: send from SUPPORT_ACCOUNT_MANAGER_EMAIL like other professional mails.
    const supportFromEmail =
      this.config.get<string>('SUPPORT_ACCOUNT_MANAGER_EMAIL')?.trim() || '';
    const mailFrom =
      supportFromEmail ||
      this.config.get<string>('MAIL_FROM')?.trim() ||
      'VybeKart Support <onboarding@resend.dev>';

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        isActive: true,
        roles: true,
        createdAt: true,
        updatedAt: true,
        // password excluded explicitly
      },
      orderBy: { createdAt: 'desc' },
    });

    const csv = this.buildCsv(users);
    const analysis = this.buildAnalysis(users, last24h);
    const { subject, html, text, filename } = this.buildEmail(now, analysis);

    this.logger.log(
      `Daily users report starting (to=${to}, rows=${users.length}, resendKey=${this.config.get<string>('RESEND_API_KEY') ? 'set' : 'unset'})`,
    );

    const resendKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    if (resendKey) {
      try {
        await this.sendViaResend(resendKey, {
          from: mailFrom,
          to,
          subject,
          html,
          text,
          attachments: [
            {
              filename,
              content: Buffer.from(csv, 'utf-8').toString('base64'),
              contentType: 'text/csv; charset=utf-8',
            },
          ],
        });
        this.logger.log(
          `Daily users report emailed via Resend to ${to} (rows=${users.length})`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Daily users report: Resend failed: ${msg}`);
        throw err;
      }
      return;
    }

    const mailHost = this.config.get<string>('MAIL_HOST')?.trim();
    if (!mailHost || mailHost.includes('@')) {
      const reason = !mailHost
        ? 'MAIL_HOST is missing'
        : 'MAIL_HOST looks like an email (must be hostname)';
      throw new Error(
        `Daily users report cannot send: RESEND_API_KEY not set and ${reason}`,
      );
    }

    try {
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
      } as any);

      await transporter.sendMail({
        from: mailFrom,
        to,
        subject,
        text,
        html,
        attachments: [
          {
            filename,
            content: csv,
            contentType: 'text/csv; charset=utf-8',
          },
        ],
      });
      this.logger.log(
        `Daily users report emailed via SMTP to ${to} (rows=${users.length})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Daily users report: SMTP failed: ${msg}`);
      throw err;
    }
  }

  private buildCsv(users: ReportUserRow[]): string {
    const headers = [
      'id',
      'email',
      'phone',
      'name',
      'isActive',
      'roles',
      'createdAt',
      'updatedAt',
    ];
    const lines: string[] = [headers.join(',')];
    for (const u of users) {
      lines.push(
        [
          csvEscape(u.id),
          csvEscape(u.email),
          csvEscape(u.phone ?? ''),
          csvEscape(u.name),
          csvEscape(u.isActive ? 'true' : 'false'),
          csvEscape(formatRoleArray(u.roles ?? [])),
          csvEscape(u.createdAt?.toISOString() ?? ''),
          csvEscape(u.updatedAt?.toISOString() ?? ''),
        ].join(','),
      );
    }
    return lines.join('\r\n') + '\r\n';
  }

  private buildAnalysis(users: ReportUserRow[], since: Date): {
    total: number;
    newLast24h: number;
    active: number;
    inactive: number;
    byRole: Record<string, number>;
  } {
    const byRole: Record<string, number> = { BUYER: 0, SELLER: 0, ADMIN: 0 };
    let active = 0;
    let inactive = 0;
    let newLast24h = 0;

    for (const u of users) {
      if (u.isActive) active += 1;
      else inactive += 1;
      if (u.createdAt && u.createdAt >= since) newLast24h += 1;

      for (const r of u.roles ?? []) {
        byRole[r] = (byRole[r] ?? 0) + 1;
      }
    }

    return {
      total: users.length,
      newLast24h,
      active,
      inactive,
      byRole,
    };
  }

  private buildEmail(
    now: Date,
    analysis: {
      total: number;
      newLast24h: number;
      active: number;
      inactive: number;
      byRole: Record<string, number>;
    },
  ): { subject: string; html: string; text: string; filename: string } {
    const brand = '#1a56c9';
    const dateIso = now.toISOString().slice(0, 10);
    const filename = `users-${dateIso}.csv`;
    const subject = `VybeKart — Daily Users Report (${dateIso})`;
    const preheader = `Daily snapshot of Users table: ${analysis.total} total, ${analysis.newLast24h} new (last 24h).`;

    const rows = [
      ['Total users', String(analysis.total)],
      ['New users (last 24h)', String(analysis.newLast24h)],
      ['Active users', String(analysis.active)],
      ['Inactive users', String(analysis.inactive)],
      ['Role: BUYER', String(analysis.byRole.BUYER ?? 0)],
      ['Role: SELLER', String(analysis.byRole.SELLER ?? 0)],
      ['Role: ADMIN', String(analysis.byRole.ADMIN ?? 0)],
      ['CSV attachment', filename],
    ];

    const rowsHtml = rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:10px 14px;border-bottom:1px solid #e8ecf1;font-size:14px;color:#64748b;width:45%;vertical-align:top;">${escapeHtml(
            k,
          )}</td><td style="padding:10px 14px;border-bottom:1px solid #e8ecf1;font-size:14px;color:#0f172a;font-weight:600;vertical-align:top;">${escapeHtml(
            v,
          )}</td></tr>`,
      )
      .join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(
      subject,
    )}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <span style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(
    preheader,
  )}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:${brand};padding:20px 24px;">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.9);">VybeKart · Daily report</p>
              <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.25;">Users table summary</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 24px 8px;">
              <p style="margin:0 0 12px;font-size:15px;color:#334155;line-height:1.55;">
                Please find attached the latest export of the <strong>Users</strong> table (password excluded) in CSV format.
              </p>
              <p style="margin:0 0 18px;font-size:12px;color:#94a3b8;">
                Generated at ${escapeHtml(now.toISOString())} · Timezone: Asia/Kolkata schedule (10:00 PM IST)
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
                ${rowsHtml}
              </table>
              <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">
                Automated message from VybeKart backend reporting. Do not forward externally.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const text = [
      subject,
      '',
      preheader,
      '',
      `Generated at: ${now.toISOString()}`,
      `Attachment: ${filename}`,
      '',
      '--- Summary ---',
      ...rows.map(([k, v]) => `${k}: ${v}`),
      '',
      'Note: Password column is excluded from CSV.',
    ].join('\n');

    return { subject, html, text, filename };
  }

  private async sendViaResend(
    apiKey: string,
    opts: {
      from: string;
      to: string;
      subject: string;
      html: string;
      text: string;
      attachments: { filename: string; content: string; contentType?: string }[];
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
        attachments: opts.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          content_type: a.contentType,
        })),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API ${res.status}: ${body}`);
    }
  }
}

