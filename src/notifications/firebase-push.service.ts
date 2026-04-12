import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

export type FcmAndroidOptions = {
  /** Android 8+ channel id — must match a channel created in the app (e.g. buyer_live_streams). */
  channelId?: string;
};

@Injectable()
export class FirebasePushService implements OnModuleInit {
  private readonly logger = new Logger(FirebasePushService.name);
  private initialized = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const json = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (!json?.trim()) {
      this.logger.warn(
        'FIREBASE_SERVICE_ACCOUNT_JSON not set — FCM push is disabled',
      );
      return;
    }
    try {
      const cred = JSON.parse(json) as admin.ServiceAccount;
      if (admin.apps.length === 0) {
        admin.initializeApp({ credential: admin.credential.cert(cred) });
      }
      this.initialized = true;
      this.logger.log('Firebase Admin initialized for FCM');
    } catch (e) {
      this.logger.error('Failed to parse/init FIREBASE_SERVICE_ACCOUNT_JSON', e);
    }
  }

  isEnabled(): boolean {
    return this.initialized && admin.apps.length > 0;
  }

  async sendToTokens(
    tokens: string[],
    title: string,
    body: string,
    data: Record<string, string>,
    android?: FcmAndroidOptions,
  ): Promise<void> {
    if (!this.isEnabled() || tokens.length === 0) return;
    const stringData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v == null ? '' : String(v)]),
    );
    const messaging = admin.messaging();
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: stringData,
      android: {
        priority: 'high' as const,
        ...(android?.channelId
          ? {
              notification: {
                channelId: android.channelId,
                sound: 'default',
              },
            }
          : {}),
      },
    });
    if (res.failureCount > 0) {
      const firstErr = res.responses.find((r) => !r.success)?.error;
      this.logger.warn(
        `FCM multicast: ${res.failureCount}/${tokens.length} failed` +
          (firstErr ? ` (e.g. ${firstErr.message})` : ''),
      );
    }
  }

  /** FCM allows up to 500 tokens per multicast; splits larger audiences automatically. */
  async sendToTokensBatched(
    tokens: string[],
    title: string,
    body: string,
    data: Record<string, string>,
    opts?: { batchSize?: number; android?: FcmAndroidOptions },
  ): Promise<void> {
    if (!this.isEnabled() || tokens.length === 0) return;
    const batchSize = opts?.batchSize ?? 500;
    const unique = [...new Set(tokens.filter((t) => t?.trim()))];
    for (let i = 0; i < unique.length; i += batchSize) {
      const batch = unique.slice(i, i + batchSize);
      await this.sendToTokens(batch, title, body, data, opts?.android);
    }
  }
}
