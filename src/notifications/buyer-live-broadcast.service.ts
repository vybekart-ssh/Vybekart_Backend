import { Injectable, Logger } from '@nestjs/common';
import { Role, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { FirebasePushService } from './firebase-push.service';

const FCM_DATA_MAX = 900;

/** One "is live" / "live ended" push per stream, even across retries, webhooks and instances. */
const STREAM_PUSH_DEDUPE_SECONDS = 24 * 60 * 60;
/** A seller restarting (app crash, reconnect) within this window doesn't re-alert buyers. */
const SELLER_LIVE_PUSH_COOLDOWN_SECONDS = 10 * 60;

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Shared Android channel id for buyer-facing live alerts (matches app channel). */
export const ANDROID_BUYER_LIVE_CHANNEL = 'buyer_live_streams';

/** Tray tag shared by a stream's "is live" and "live ended" pushes so the latter replaces the former. */
function liveTag(streamId: string): string {
  return `live:${streamId}`;
}

@Injectable()
export class BuyerLiveBroadcastService {
  private readonly logger = new Logger(BuyerLiveBroadcastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebasePushService,
    private readonly redis: RedisService,
  ) {}

  /** True the first time [key] is claimed; false if this push was already sent. */
  private async claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
    try {
      return await this.redis.setNx(key, '1', ttlSeconds);
    } catch (e) {
      // Redis unavailable: still notify rather than silently dropping the alert.
      this.logger.warn(`Push dedupe unavailable for ${key}: ${String(e)}`);
      return true;
    }
  }

  private async wasSent(key: string): Promise<boolean> {
    try {
      return (await this.redis.get(key)) != null;
    } catch {
      return true;
    }
  }

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
      if (!(await this.claimOnce(`push:live-started:${params.streamId}`, STREAM_PUSH_DEDUPE_SECONDS))) {
        this.logger.log(`Live-started push already sent for stream ${params.streamId}; skip`);
        return;
      }
      if (
        !(await this.claimOnce(
          `push:seller-live-cooldown:${params.sellerUserId}`,
          SELLER_LIVE_PUSH_COOLDOWN_SECONDS,
        ))
      ) {
        this.logger.log(
          `Seller ${params.sellerUserId} went live again within cooldown; skip buyer push for stream ${params.streamId}`,
        );
        return;
      }
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
          android: { channelId: ANDROID_BUYER_LIVE_CHANNEL, tag: liveTag(params.streamId) },
        },
      );
      await this.redis
        .set(`push:live-started-sent:${params.streamId}`, '1', STREAM_PUSH_DEDUPE_SECONDS)
        .catch(() => undefined);
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
      // Buyers who never got "is live" for this stream shouldn't get "live ended" either.
      if (!(await this.wasSent(`push:live-started-sent:${params.streamId}`))) return;
      if (!(await this.claimOnce(`push:live-ended:${params.streamId}`, STREAM_PUSH_DEDUPE_SECONDS))) {
        this.logger.log(`Live-ended push already sent for stream ${params.streamId}; skip`);
        return;
      }
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
          android: { channelId: ANDROID_BUYER_LIVE_CHANNEL, tag: liveTag(params.streamId) },
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
