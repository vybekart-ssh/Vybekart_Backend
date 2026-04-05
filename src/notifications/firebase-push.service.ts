import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

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
  ): Promise<void> {
    if (!this.isEnabled() || tokens.length === 0) return;
    const messaging = admin.messaging();
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
      android: { priority: 'high' as const },
    });
    if (res.failureCount > 0) {
      this.logger.warn(
        `FCM multicast: ${res.failureCount}/${tokens.length} failed`,
      );
    }
  }
}
