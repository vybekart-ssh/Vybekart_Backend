import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type Fast2SmsSendResult = {
  ok: boolean;
  requestId?: string;
  raw?: unknown;
};

@Injectable()
export class Fast2SmsService implements OnModuleInit {
  private readonly logger = new Logger(Fast2SmsService.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const route = (this.config.get<string>('FAST2SMS_ROUTE') ?? 'q').trim();
    const otpEnv = (this.config.get<string>('OTP_ENV') ?? '').trim();
    if (route !== 'dlt' || otpEnv !== 'production') return;

    const missing = [
      'FAST2SMS_SENDER_ID',
      'FAST2SMS_DLT_MSG_ID_LOGIN',
      'FAST2SMS_DLT_MSG_ID_BUYER_SIGNUP',
      'FAST2SMS_DLT_MSG_ID_SELLER_SIGNUP',
      'FAST2SMS_DLT_MSG_ID_FORGOT_PASSWORD',
    ].filter((key) => !(this.config.get<string>(key) ?? '').trim());

    if (missing.length > 0) {
      this.logger.warn(
        `FAST2SMS_ROUTE=dlt but missing env: ${missing.join(', ')} — OTP SMS will fail until set`,
      );
    }
  }

  private get endpoint(): string {
    return this.config.get<string>('FAST2SMS_ENDPOINT')!;
  }

  private get apiKey(): string | undefined {
    return this.config.get<string>('FAST2SMS_API_KEY')?.trim();
  }

  private normalizeIndianPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) {
      return digits.slice(2);
    }
    return digits;
  }

  private async postBulkV2(
    body: URLSearchParams,
  ): Promise<Fast2SmsSendResult> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      this.logger.warn('FAST2SMS_API_KEY not set — SMS send skipped');
      return { ok: false };
    }

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      const text = await res.text();
      let json: unknown = undefined;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = { rawText: text };
      }

      if (!res.ok) {
        this.logger.warn(
          `Fast2SMS failed: status=${res.status} body=${JSON.stringify(json)}`,
        );
        return { ok: false, raw: json };
      }

      const requestId =
        typeof json === 'object' && json != null
          ? // @ts-expect-error: best-effort extraction
            (json.request_id ?? json.requestId ?? json.message_id)
          : undefined;
      return {
        ok: true,
        requestId: requestId ? String(requestId) : undefined,
        raw: json,
      };
    } catch (err) {
      this.logger.warn(`Fast2SMS send error: ${String(err)}`);
      return { ok: false };
    }
  }

  async sendTextSms(params: {
    toPhone: string;
    message: string;
  }): Promise<Fast2SmsSendResult> {
    const route = (this.config.get<string>('FAST2SMS_ROUTE') ?? 'q').trim();
    const senderId = this.config.get<string>('FAST2SMS_SENDER_ID')?.trim();

    const body = new URLSearchParams();
    body.set('route', route);
    body.set('message', params.message);
    body.set('numbers', this.normalizeIndianPhone(params.toPhone));
    if (senderId) body.set('sender_id', senderId);

    return this.postBulkV2(body);
  }

  /** DLT-compliant OTP SMS via Fast2SMS DLT Manager message_id. */
  async sendDltSms(params: {
    toPhone: string;
    messageId: string;
    variablesValues: string;
  }): Promise<Fast2SmsSendResult> {
    const senderId = this.config.get<string>('FAST2SMS_SENDER_ID')?.trim();
    if (!senderId) {
      this.logger.warn('FAST2SMS_SENDER_ID not set — DLT SMS send skipped');
      return { ok: false };
    }
    if (!params.messageId.trim()) {
      this.logger.warn('DLT message_id missing — SMS send skipped');
      return { ok: false };
    }

    const body = new URLSearchParams();
    body.set('route', 'dlt');
    body.set('sender_id', senderId);
    body.set('message', params.messageId.trim());
    body.set('variables_values', params.variablesValues);
    body.set('numbers', this.normalizeIndianPhone(params.toPhone));

    return this.postBulkV2(body);
  }
}
