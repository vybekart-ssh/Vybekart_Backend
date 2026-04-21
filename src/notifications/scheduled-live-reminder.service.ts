import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FirebasePushService } from './firebase-push.service';
import {
  BuyerLiveBroadcastService,
  ANDROID_BUYER_LIVE_CHANNEL,
} from './buyer-live-broadcast.service';

const FCM_DATA_MAX = 900;

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Sends one FCM per scheduled stream when `startedAt` falls in a ±2 minute window
 * (aligned with cron every minute). Deduped with `Stream.goLiveReminderSentAt`.
 */
@Injectable()
export class ScheduledLiveReminderService {
  private readonly logger = new Logger(ScheduledLiveReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebasePushService,
    private readonly buyerLiveBroadcast: BuyerLiveBroadcastService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sendDueReminders(): Promise<void> {
    if (!this.firebase.isEnabled()) return;

    const now = new Date();
    const from = new Date(now.getTime() - 120_000);
    const to = new Date(now.getTime() + 120_000);

    const streams = await this.prisma.stream.findMany({
      where: {
        isLive: false,
        endedAt: null,
        goLiveReminderSentAt: null,
        startedAt: { gte: from, lte: to },
      },
      include: {
        seller: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
    });

    for (const s of streams) {
      const userId = s.seller.userId;
      const devices = await this.prisma.userPushDevice.findMany({
        where: { userId },
        select: { fcmToken: true },
      });
      const sellerTokens = devices.map((d) => d.fcmToken);

      if (sellerTokens.length > 0) {
        try {
          await this.firebase.sendToTokens(
            sellerTokens,
            'Time to go live',
            `Your scheduled live "${s.title}" is starting.`,
            {
              type: 'SELLER_GO_LIVE_REMINDER',
              streamId: s.id,
            },
            { channelId: 'seller_go_live' },
          );
        } catch (e) {
          this.logger.warn(`FCM failed for stream ${s.id} (seller)`, e);
          continue;
        }
      } else {
        this.logger.debug(
          `No FCM tokens for seller user ${userId}; skipping seller push for stream ${s.id}`,
        );
      }

      const sellerDisplay =
        s.seller.user?.name?.trim() ||
        s.seller.businessName?.trim() ||
        'A seller';
      const name = clip(sellerDisplay, 80);
      try {
        const buyerTokens =
          await this.buyerLiveBroadcast.getBuyerLiveAudienceFcmTokens(userId);
        if (buyerTokens.length > 0) {
          await this.firebase.sendToTokensBatched(
            buyerTokens,
            clip('Live starting soon', 120),
            clip(
              `${name}'s scheduled live "${s.title}" is starting.`,
              200,
            ),
            {
              type: 'SCHEDULED_LIVE_STARTING',
              streamId: clip(s.id, 64),
              sellerName: clip(name, FCM_DATA_MAX),
              streamTitle: clip(s.title, FCM_DATA_MAX),
            },
            { android: { channelId: ANDROID_BUYER_LIVE_CHANNEL } },
          );
          this.logger.log(
            `Scheduled-live buyer reminder queued for ${buyerTokens.length} device(s), stream ${s.id}`,
          );
        }
      } catch (e) {
        this.logger.warn(`FCM failed for stream ${s.id} (buyers)`, e);
      }

      await this.prisma.stream.update({
        where: { id: s.id },
        data: { goLiveReminderSentAt: now },
      });
    }
  }
}
