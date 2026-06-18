import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resendFetch } from '../common/utils/resend-fetch';
import { parseSellerEmailRecipients } from './seller-email-csv.util';
import {
  collectAttachments,
  resolveSellerEmailImage,
  SELLER_EMAIL_ASSET_FILES,
  VYBEKART_PLAY_STORE_URL,
} from './seller-email-images.util';
import {
  buildSellerEmail1,
  buildSellerEmail2,
  mergeBuiltWithAttachments,
  resolveInterestUrl,
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

  private outreachFrom(): string {
    const explicit = this.config.get<string>('SELLER_OUTREACH_FROM')?.trim();
    if (explicit) return explicit;
    const { ceoName, ceoEmail } = this.ceoDefaults();
    return `${ceoName} <${ceoEmail}>`;
  }

  /** Live sends default to plain text only — best chance of Gmail Primary. */
  private outreachTextOnly(): boolean {
    const v = this.config.get<string>('SELLER_OUTREACH_TEXT_ONLY')?.trim().toLowerCase();
    return v !== 'false' && v !== '0';
  }

  buildEmail(
    kind: SellerEmailKind,
    recipient: SellerEmailRecipient,
    forPreview: boolean,
  ): BuiltSellerEmail {
    const ceo = this.ceoDefaults();
    const richContent = forPreview;
    const base = {
      recipientEmail: recipient.email,
      storeName: recipient.storeName,
      contactName: recipient.contactName,
      richContent,
      ...ceo,
    };

    if (kind === 'email1') {
      const img = richContent
        ? resolveSellerEmailImage(this.config, {
            envUrlKey: 'SELLER_INTRO_IMAGE_URL',
            assetFileName: SELLER_EMAIL_ASSET_FILES.visibilityIntro,
            objectKey: `email/${SELLER_EMAIL_ASSET_FILES.visibilityIntro}`,
            contentId: 'seller-visibility-intro',
            forPreview: true,
          })
        : { src: '' };
      const built = buildSellerEmail1(this.config, {
        ...base,
        visibilityImageSrc: img.src,
      });
      return richContent
        ? mergeBuiltWithAttachments(built, [img])
        : { ...built, attachments: [] };
    }

    const stepsImg = richContent
      ? resolveSellerEmailImage(this.config, {
          envUrlKey: 'SELLER_STEPS_IMAGE_URL',
          assetFileName: SELLER_EMAIL_ASSET_FILES.goLiveSteps,
          objectKey: `email/${SELLER_EMAIL_ASSET_FILES.goLiveSteps}`,
          contentId: 'seller-go-live-steps',
          forPreview: true,
        })
      : { src: '' };
    const interestUrl = resolveInterestUrl(this.config, recipient);
    const built = buildSellerEmail2(this.config, {
      ...base,
      stepsImageSrc: stepsImg.src,
      interestUrl,
      appDownloadUrl:
        this.config.get<string>('APP_DOWNLOAD_URL')?.trim() ||
        VYBEKART_PLAY_STORE_URL,
    });
    return richContent
      ? mergeBuiltWithAttachments(built, [stepsImg])
      : { ...built, attachments: [] };
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
      const id = await this.sendViaResend(apiKey, recipient.email, built);
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
  ): Promise<string> {
    const { ceoEmail } = this.ceoDefaults();
    const messageId = `<vybekart-seller-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@vybekart.co.in>`;
    const textOnly = this.outreachTextOnly();
    const body: Record<string, unknown> = {
      from: this.outreachFrom(),
      to: [to],
      subject: built.subject,
      text: built.text,
      reply_to: ceoEmail,
      headers: {
        'Message-ID': messageId,
      },
    };
    if (!textOnly && built.html) {
      body.html = built.html;
      if (built.attachments.length) {
        body.attachments = built.attachments;
      }
    }

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
