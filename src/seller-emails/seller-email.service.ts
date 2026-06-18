import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VYBEKART_BRAND_NAME } from '../mail/templates/vybekart-email-layout';
import { resendFetch } from '../common/utils/resend-fetch';
import { parseSellerEmailRecipients } from './seller-email-csv.util';
import {
  resolveSellerEmailImage,
  SELLER_EMAIL_ASSET_FILES,
  VYBEKART_PLAY_STORE_URL,
} from './seller-email-images.util';
import {
  buildSellerEmail1,
  buildSellerEmail2,
  mergeBuiltWithAttachments,
  SELLER_OUTREACH_THREAD_SUBJECT,
} from './seller-email-templates';
import {
  BuiltSellerEmail,
  SellerEmailKind,
  SellerEmailRecipient,
  SellerEmailSendResult,
} from './seller-email.types';

@Injectable()
export class SellerEmailService {
  private readonly logger = new Logger(SellerEmailService.name);

  constructor(private readonly config: ConfigService) {}

  parseRecipientsFromCsv(csvContent: string): SellerEmailRecipient[] {
    const rows = parseSellerEmailRecipients(csvContent);
    if (rows.length === 0) {
      throw new BadRequestException(
        'No valid rows found. CSV needs columns: email, store_name, contact_name',
      );
    }
    return rows;
  }

  private ceoDefaults() {
    return {
      ceoName: this.config.get<string>('CEO_NAME')?.trim() || 'Hiren Prajapati',
      ceoEmail:
        this.config.get<string>('CEO_EMAIL')?.trim() || 'ceo@vybekart.co.in',
      ceoPhone:
        this.config.get<string>('CEO_PHONE')?.trim() || '+91-8169139848',
      website:
        this.config.get<string>('ALPHA_WEBSITE_URL')?.trim() ||
        'https://www.vybekart.co.in',
    };
  }

  /** Human 1:1 sender — "Hiren from Vybekart", not a brand blast address. */
  private outreachFrom(): string {
    const explicit = this.config.get<string>('SELLER_OUTREACH_FROM')?.trim();
    if (explicit) return explicit;
    const { ceoName, ceoEmail } = this.ceoDefaults();
    const first = ceoName.split(/\s+/)[0] || ceoName;
    return `${first} from ${VYBEKART_BRAND_NAME} <${ceoEmail}>`;
  }

  buildEmail(
    kind: SellerEmailKind,
    recipient: SellerEmailRecipient,
    forPreview: boolean,
  ): BuiltSellerEmail {
    const ceo = this.ceoDefaults();
    const base = {
      recipientEmail: recipient.email,
      storeName: recipient.storeName,
      contactName: recipient.contactName,
      forPreview,
      ...ceo,
    };

    if (kind === 'email1') {
      const built = buildSellerEmail1(this.config, base);
      if (!forPreview) {
        return { ...built, attachments: [] };
      }
      const img = resolveSellerEmailImage(this.config, {
        envUrlKey: 'SELLER_INTRO_IMAGE_URL',
        assetFileName: SELLER_EMAIL_ASSET_FILES.visibilityIntro,
        objectKey: `email/${SELLER_EMAIL_ASSET_FILES.visibilityIntro}`,
        contentId: 'seller-visibility-intro',
        forPreview: true,
      });
      return mergeBuiltWithAttachments(
        buildSellerEmail1(this.config, {
          ...base,
          visibilityImageSrc: img.src,
        }),
        [img],
      );
    }

    const built = buildSellerEmail2(this.config, {
      ...base,
      appDownloadUrl:
        this.config.get<string>('APP_DOWNLOAD_URL')?.trim() ||
        VYBEKART_PLAY_STORE_URL,
    });
    if (!forPreview) {
      return { ...built, attachments: [] };
    }
    const stepsImg = resolveSellerEmailImage(this.config, {
      envUrlKey: 'SELLER_STEPS_IMAGE_URL',
      assetFileName: SELLER_EMAIL_ASSET_FILES.goLiveSteps,
      objectKey: `email/${SELLER_EMAIL_ASSET_FILES.goLiveSteps}`,
      contentId: 'seller-go-live-steps',
      forPreview: true,
    });
    return mergeBuiltWithAttachments(
      buildSellerEmail2(this.config, {
        ...base,
        stepsImageSrc: stepsImg.src,
        appDownloadUrl:
          this.config.get<string>('APP_DOWNLOAD_URL')?.trim() ||
          VYBEKART_PLAY_STORE_URL,
      }),
      [stepsImg],
    );
  }

  async sendOne(
    kind: SellerEmailKind,
    recipient: SellerEmailRecipient,
    dryRun: boolean,
  ): Promise<SellerEmailSendResult> {
    const built = this.buildEmail(kind, recipient, false);
    if (dryRun) {
      return {
        email: recipient.email,
        storeName: recipient.storeName,
        ok: true,
        resendId: 'dry-run',
      };
    }

    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    if (!apiKey) {
      return {
        email: recipient.email,
        storeName: recipient.storeName,
        ok: false,
        error: 'RESEND_API_KEY is not configured on the server',
      };
    }

    try {
      const id = await this.sendViaResend(apiKey, recipient.email, built, kind);
      return {
        email: recipient.email,
        storeName: recipient.storeName,
        ok: true,
        resendId: id,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send to ${recipient.email}: ${message}`);
      return {
        email: recipient.email,
        storeName: recipient.storeName,
        ok: false,
        error: message,
      };
    }
  }

  async sendBatch(opts: {
    kind: SellerEmailKind;
    recipients: SellerEmailRecipient[];
    dryRun?: boolean;
    delayMs?: number;
  }): Promise<{
    kind: SellerEmailKind;
    total: number;
    sent: number;
    failed: number;
    results: SellerEmailSendResult[];
  }> {
    if (!opts.recipients.length) {
      throw new BadRequestException('No recipients to send');
    }

    const delayMs =
      opts.delayMs ??
      Number(this.config.get<string>('SELLER_EMAIL_SEND_DELAY_MS') || 600);

    const results: SellerEmailSendResult[] = [];
    for (let i = 0; i < opts.recipients.length; i++) {
      const r = opts.recipients[i];
      results.push(await this.sendOne(opts.kind, r, !!opts.dryRun));
      if (i < opts.recipients.length - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const sent = results.filter((x) => x.ok).length;
    return {
      kind: opts.kind,
      total: results.length,
      sent,
      failed: results.length - sent,
      results,
    };
  }

  private async sendViaResend(
    apiKey: string,
    to: string,
    built: BuiltSellerEmail,
    kind: SellerEmailKind,
  ): Promise<string> {
    const { ceoEmail } = this.ceoDefaults();
    const messageId = `<seller-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@vybekart.co.in>`;
    const headers: Record<string, string> = {
      'Message-ID': messageId,
    };
    if (kind === 'email2') {
      headers['In-Reply-To'] = `<thread-${SELLER_OUTREACH_THREAD_SUBJECT.replace(/\s+/g, '-').toLowerCase()}@vybekart.co.in>`;
      headers.References = headers['In-Reply-To'];
    }

    const body: Record<string, unknown> = {
      from: this.outreachFrom(),
      to: [to],
      subject: built.subject,
      text: built.text,
      reply_to: ceoEmail,
      headers,
    };

    const res = await resendFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const bodyText = await res.text();
    if (!res.ok) throw new Error(`Resend API ${res.status}: ${bodyText}`);
    try {
      return (JSON.parse(bodyText) as { id?: string }).id || bodyText;
    } catch {
      return bodyText;
    }
  }
}
