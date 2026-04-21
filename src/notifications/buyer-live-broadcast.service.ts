import { Injectable, Logger } from '@nestjs/common';
import { Role, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FirebasePushService } from './firebase-push.service';

const FCM_DATA_MAX = 900;

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Shared Android channel id for buyer-facing live alerts (matches app channel). */
export const ANDROID_BUYER_LIVE_CHANNEL = 'buyer_live_streams';

@Injectable()
export class BuyerLiveBroadcastService {
  private readonly logger = new Logger(BuyerLiveBroadcastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebasePushService,
  ) {}

  /**
   * Users who should receive buyer live alerts: has buyer profile or BUYER role,
   * but not seller-only (seller profile without buyer profile).
   * @param excludeUserId e.g. the host — never notify the broadcasting seller on their own event.
   */
  async getBuyerLiveAudienceFcmTokens(excludeUserId?: string): Promise<string[]> {
    const andParts: Prisma.UserWhereInput[] = [
      {
        NOT: {
          AND: [
            { sellerProfile: { isNot: null } },
            { buyerProfile: { is: null } },
          ],
        },
      },
      {
        OR: [
          { buyerProfile: { isNot: null } },
          { roles: { has: Role.BUYER } },
        ],
      },
    ];
    if (excludeUserId) {
      andParts.push({ id: { not: excludeUserId } });
    }

    const rows = await this.prisma.userPushDevice.findMany({
      where: { user: { AND: andParts } },
      select: { fcmToken: true },
    });
    const tokens: string[] = rows
      .map((r) => r.fcmToken)
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
    return [...new Set(tokens)];
  }

  async notifyBuyersSellerWentLive(params: {
    streamId: string;
    title: string;
    sellerUserId: string;
    sellerDisplayName: string;
  }): Promise<void> {
    if (!this.firebase.isEnabled()) return;
    try {
      const tokens = await this.getBuyerLiveAudienceFcmTokens(
        params.sellerUserId,
      );
      if (tokens.length === 0) {
        this.logger.warn(
          'No buyer FCM tokens for live-started broadcast; skip',
        );
        return;
      }
      const name = clip(params.sellerDisplayName || 'A seller', 80);
      const title = clip(`${name} is live`, 120);
      const body = clip(params.title || 'Tap to watch', 200);
      await this.firebase.sendToTokensBatched(
        tokens,
        title,
        body,
        {
          type: 'SELLER_LIVE_STARTED',
          streamId: clip(params.streamId, 64),
          sellerName: clip(name, FCM_DATA_MAX),
          streamTitle: clip(params.title, FCM_DATA_MAX),
        },
        {
          android: { channelId: ANDROID_BUYER_LIVE_CHANNEL },
        },
      );
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
      const tokens = await this.getBuyerLiveAudienceFcmTokens(
        params.sellerUserId,
      );
      if (tokens.length === 0) {
        this.logger.warn(
          'No buyer FCM tokens for live-ended broadcast; skip',
        );
        return;
      }
      const name = clip(params.sellerDisplayName || 'A seller', 80);
      const title = clip(`Live ended: ${name}`, 120);
      const body = clip(params.title || 'The stream has ended', 200);
      await this.firebase.sendToTokensBatched(
        tokens,
        title,
        body,
        {
          type: 'SELLER_LIVE_ENDED',
          streamId: clip(params.streamId, 64),
          sellerName: clip(name, FCM_DATA_MAX),
          streamTitle: clip(params.title, FCM_DATA_MAX),
        },
        {
          android: { channelId: ANDROID_BUYER_LIVE_CHANNEL },
        },
      );
      this.logger.log(
        `Live-ended push queued for ${tokens.length} buyer device(s), stream ${params.streamId}`,
      );
    } catch (e) {
      this.logger.warn(`Buyer live-ended broadcast failed: ${String(e)}`);
    }
  }
}
