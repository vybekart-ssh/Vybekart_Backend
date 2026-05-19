import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import * as nodemailer from 'nodemailer';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

function isTruthyFlag(v: string | undefined): boolean {
  const t = (v ?? '').trim().toLowerCase();
  return t === 'true' || t === '1' || t === 'yes';
}

type ResendAttachment = {
  filename: string;
  content: string; // base64
  contentType?: string;
};

type ResendSendEmailInput = {
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: ResendAttachment[];
};

@Injectable()
export class DailyDbBackupService {
  private readonly logger = new Logger(DailyDbBackupService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Daily database backup:
   * - dumps FULL database (schema + data) via pg_dump
   * - gzips result
   * - emails as attachment (Resend preferred; SMTP fallback)
   */
  @Cron('0 0 3 * * *', { timeZone: 'Asia/Kolkata' })
  async runDailyBackup(): Promise<void> {
    const enabled = isTruthyFlag(
      this.config.get<string>('DAILY_DB_BACKUP_ENABLED') ?? 'true',
    );
    if (!enabled) return;

    const to =
      this.config.get<string>('DAILY_DB_BACKUP_TO')?.trim() ||
      this.config.get<string>('DAILY_USERS_REPORT_TO')?.trim() ||
      this.config.get<string>('MAIL_USER')?.trim() ||
      'vybekart88@gmail.com';

    const supportFromEmail =
      this.config.get<string>('SUPPORT_ACCOUNT_MANAGER_EMAIL')?.trim() || '';
    const mailFrom =
      supportFromEmail ||
      this.config.get<string>('MAIL_FROM')?.trim() ||
      'VybeKart Support <onboarding@resend.dev>';

    const directUrl =
      this.config.get<string>('DIRECT_URL')?.trim() ||
      this.config.get<string>('DATABASE_URL')?.trim() ||
      '';
    if (!directUrl) {
      throw new Error('DAILY_DB_BACKUP: DIRECT_URL/DATABASE_URL missing');
    }

    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const filename = `vybekart-db-backup-${day}.sql.gz`;
    const tmpPath = path.join(
      process.env.TMPDIR || process.env.TEMP || '/tmp',
      `${day}-${crypto.randomUUID?.() ?? crypto.randomBytes(12).toString('hex')}-${filename}`,
    );

    this.logger.log(`Daily DB backup starting (to=${to}, file=${filename})`);

    try {
      await this.dumpToGzipFile(directUrl, tmpPath);
      const gz = fs.readFileSync(tmpPath);

      const subject = `VybeKart DB backup (${day})`;
      const text =
        'Attached is the daily VybeKart database backup.\n\n' +
        'Note: this is a server-side pg_dump export.\n';

      const resendKey = this.config.get<string>('RESEND_API_KEY')?.trim();
      if (resendKey) {
        await this.sendViaResend(resendKey, {
          from: mailFrom,
          to,
          subject,
          text,
          attachments: [
            {
              filename,
              content: gz.toString('base64'),
              contentType: 'application/gzip',
            },
          ],
        });
        this.logger.log(`Daily DB backup emailed via Resend to ${to}`);
        return;
      }

      const mailHost = this.config.get<string>('MAIL_HOST')?.trim();
      if (!mailHost || mailHost.includes('@')) {
        const reason = !mailHost
          ? 'MAIL_HOST is missing'
          : 'MAIL_HOST looks like an email (must be hostname)';
        throw new Error(
          `Daily DB backup cannot send: RESEND_API_KEY not set and ${reason}`,
        );
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
      } as any);

      await transporter.sendMail({
        from: mailFrom,
        to,
        subject,
        text,
        attachments: [
          {
            filename,
            content: gz,
            contentType: 'application/gzip',
          },
        ],
      });
      this.logger.log(`Daily DB backup emailed via SMTP to ${to}`);
    } finally {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
    }
  }

  private async dumpToGzipFile(dbUrl: string, outGzPath: string): Promise<void> {
    const u = new URL(dbUrl);
    if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') {
      throw new Error('DAILY_DB_BACKUP: URL must be postgres');
    }
    const user = decodeURIComponent(u.username || '');
    const pass = decodeURIComponent(u.password || '');
    const host = u.hostname;
    const port = u.port || '5432';
    const dbName = (u.pathname || '/').replace(/^\//, '') || 'postgres';

    await fs.promises.mkdir(path.dirname(outGzPath), { recursive: true });

    const args = [
      '--no-owner',
      '--no-privileges',
      '-h',
      host,
      '-p',
      port,
      '-U',
      user,
      '-d',
      dbName,
    ];

    await new Promise<void>((resolve, reject) => {
      const dump = spawn('pg_dump', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PGPASSWORD: pass,
        },
      });

      let stderr = '';
      dump.stderr.on('data', (b) => {
        stderr += b.toString();
      });

      const gzip = zlib.createGzip({ level: 9 });
      const out = fs.createWriteStream(outGzPath);

      dump.stdout.pipe(gzip).pipe(out);

      dump.on('error', (e) => reject(e));
      out.on('error', (e) => reject(e));
      out.on('finish', () => resolve());

      dump.on('close', (code) => {
        if (code === 0) return;
        reject(new Error(`pg_dump failed (code=${code}): ${stderr.trim()}`));
      });
    });
  }

  private async sendViaResend(
    resendKey: string,
    input: ResendSendEmailInput,
  ): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API ${res.status}: ${body}`);
    }
  }
}

