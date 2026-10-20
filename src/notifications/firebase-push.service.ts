import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';

export type FcmAndroidOptions = {
  /** Android 8+ channel id — must match a channel created in the app (e.g. buyer_live_streams). */
  channelId?: string;
  /**
   * Notifications with the same tag replace each other in the tray instead of stacking,
   * so a repeated push for the same event never shows twice.
   */
  tag?: string;
  /** Public HTTPS image shown as a big picture. */
  imageUrl?: string;
};

export type FcmSendResult = { success: number; failure: number };

/** FCM errors meaning the token will never work again (uninstalled app, revoked token). */
const DEAD_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

@Injectable()
export class FirebasePushService implements OnModuleInit {
  private readonly logger = new Logger(FirebasePushService.name);
  private initialized = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

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
  ): Promise<FcmSendResult> {
    if (!this.isEnabled() || tokens.length === 0) return { success: 0, failure: 0 };
    const stringData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v == null ? '' : String(v)]),
    );
    const imageUrl = android?.imageUrl?.trim() || undefined;
    const androidNotification = {
      ...(android?.channelId ? { channelId: android.channelId, sound: 'default' } : {}),
      ...(android?.tag ? { tag: android.tag } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    };
    const messaging = admin.messaging();
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body, ...(imageUrl ? { imageUrl } : {}) },
      data: stringData,
      android: {
        priority: 'high' as const,
        ...(Object.keys(androidNotification).length > 0
          ? { notification: androidNotification }
          : {}),
      },
    });
    if (res.failureCount > 0) {
      const firstErr = res.responses.find((r) => !r.success)?.error;
      this.logger.warn(
        `FCM multicast: ${res.failureCount}/${tokens.length} failed` +
          (firstErr ? ` (e.g. ${firstErr.message})` : ''),
      );
      const dead = tokens.filter((_, i) => {
        const code = res.responses[i]?.error?.code;
        return code != null && DEAD_TOKEN_ERRORS.has(code);
      });
      if (dead.length > 0) {
        await this.prisma.userPushDevice
          .deleteMany({ where: { fcmToken: { in: dead } } })
          .catch((e) => this.logger.warn(`Dead FCM token cleanup failed: ${String(e)}`));
      }
    }
    return { success: res.successCount, failure: res.failureCount };
  }

  /** FCM allows up to 500 tokens per multicast; splits larger audiences automatically. */
  async sendToTokensBatched(
    tokens: string[],
    title: string,
    body: string,
    data: Record<string, string>,
    opts?: { batchSize?: number; android?: FcmAndroidOptions },
  ): Promise<FcmSendResult> {
    const total: FcmSendResult = { success: 0, failure: 0 };
    if (!this.isEnabled() || tokens.length === 0) return total;
    const batchSize = opts?.batchSize ?? 500;
    const unique = [...new Set(tokens.filter((t) => t?.trim()))];
    for (let i = 0; i < unique.length; i += batchSize) {
      const batch = unique.slice(i, i + batchSize);
      const r = await this.sendToTokens(batch, title, body, data, opts?.android);
      total.success += r.success;
      total.failure += r.failure;
    }
    return total;
  }
}
