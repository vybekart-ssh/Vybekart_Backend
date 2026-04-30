import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type Fast2SmsSendResult = {
  ok: boolean;
  requestId?: string;
  raw?: unknown;
};

@Injectable()
export class Fast2SmsService {
  private readonly logger = new Logger(Fast2SmsService.name);

  constructor(private readonly config: ConfigService) {}

  private get endpoint(): string {
    return this.config.get<string>('FAST2SMS_ENDPOINT')!;
  }

  private get apiKey(): string | undefined {
    return this.config.get<string>('FAST2SMS_API_KEY')?.trim();
  }

  async sendTextSms(params: {
    toPhone: string;
    message: string;
  }): Promise<Fast2SmsSendResult> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      this.logger.warn('FAST2SMS_API_KEY not set — SMS send skipped');
      return { ok: false };
    }

    const route = (this.config.get<string>('FAST2SMS_ROUTE') ?? 'q').trim();
    const senderId = this.config.get<string>('FAST2SMS_SENDER_ID')?.trim();

    // Fast2SMS bulkV2 expects x-www-form-urlencoded.
    const body = new URLSearchParams();
    body.set('route', route);
    body.set('message', params.message);
    body.set('numbers', params.toPhone.replace(/^\+/, '')); // API typically expects digits only
    if (senderId) body.set('sender_id', senderId);

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
        // Keep raw text when JSON parsing fails.
        json = { rawText: text };
      }

      if (!res.ok) {
        this.logger.warn(
          `Fast2SMS failed: status=${res.status} body=${JSON.stringify(json)}`,
        );
        return { ok: false, raw: json };
      }

      // Fast2SMS response formats vary by route; keep raw for debugging.
      const requestId =
        typeof json === 'object' && json != null
          ? // @ts-expect-error: best-effort extraction
            (json.request_id ?? json.requestId ?? json.message_id)
          : undefined;
      return { ok: true, requestId: requestId ? String(requestId) : undefined, raw: json };
    } catch (err) {
      this.logger.warn(`Fast2SMS send error: ${String(err)}`);
      return { ok: false };
    }
  }
}

