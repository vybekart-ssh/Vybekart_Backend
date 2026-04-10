import { Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FirebasePushService } from './firebase-push.service';

const FCM_DATA_MAX = 900;

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

@Injectable()
export class BuyerLiveBroadcastService {
  private readonly logger = new Logger(BuyerLiveBroadcastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebasePushService,
  ) {}

  /**
   * All registered FCM tokens for users who have the BUYER role (excluding the host).
   */
  private async getBuyerFcmTokens(excludeUserId: string): Promise<string[]> {
    const rows = await this.prisma.userPushDevice.findMany({
      where: {
        user: {
          roles: { has: Role.BUYER },
          id: { not: excludeUserId },
        },
      },
      select: { fcmToken: true },
    });
    return rows.map((r) => r.fcmToken);
  }

  async notifyBuyersSellerWentLive(params: {
    streamId: string;
    title: string;
    sellerUserId: string;
    sellerDisplayName: string;
  }): Promise<void> {
    if (!this.firebase.isEnabled()) return;
    try {
      const tokens = await this.getBuyerFcmTokens(params.sellerUserId);
      if (tokens.length === 0) {
        this.logger.debug('No buyer FCM tokens; skip live-started broadcast');
        return;
      }
      const name = clip(params.sellerDisplayName || 'A seller', 80);
      const title = clip(`${name} is live`, 120);
      const body = clip(params.title || 'Tap to watch', 200);
      await this.firebase.sendToTokensBatched(tokens, title, body, {
        type: 'SELLER_LIVE_STARTED',
        streamId: clip(params.streamId, 64),
        sellerName: clip(name, FCM_DATA_MAX),
        streamTitle: clip(params.title, FCM_DATA_MAX),
      });
      this.logger.log(
        `Live-started push queued for ${tokens.length} buyer device(s), stream ${params.streamId}`,
      );
    } catch (e) {
      this.logger.warn(`Buyer live-started broadcast failed: ${String(e)}`);
    }
  }

  async notifyBuyersLiveEnded(params: {
    streamId: string;
    title: string;
    sellerUserId: string;
    sellerDisplayName: string;
  }): Promise<void> {
    if (!this.firebase.isEnabled()) return;
    try {
      const tokens = await this.getBuyerFcmTokens(params.sellerUserId);
      if (tokens.length === 0) {
        this.logger.debug('No buyer FCM tokens; skip live-ended broadcast');
        return;
      }
      const name = clip(params.sellerDisplayName || 'A seller', 80);
      const title = clip(`Live ended: ${name}`, 120);
      const body = clip(params.title || 'The stream has ended', 200);
      await this.firebase.sendToTokensBatched(tokens, title, body, {
        type: 'SELLER_LIVE_ENDED',
        streamId: clip(params.streamId, 64),
        sellerName: clip(name, FCM_DATA_MAX),
        streamTitle: clip(params.title, FCM_DATA_MAX),
      });
      this.logger.log(
        `Live-ended push queued for ${tokens.length} buyer device(s), stream ${params.streamId}`,
      );
    } catch (e) {
      this.logger.warn(`Buyer live-ended broadcast failed: ${String(e)}`);
    }
  }
}
