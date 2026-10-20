import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FirebasePushService } from './firebase-push.service';

/**
 * Reminds the seller once per scheduled stream when `startedAt` falls in a ±2 minute window
 * (cron every minute). Each stream is claimed via `Stream.goLiveReminderSentAt` before sending,
 * so overlapping runs or instances can't remind twice. Buyers are alerted by the
 * "seller is live" push when the stream actually starts — not here, to avoid back-to-back pushes.
 */
@Injectable()
export class ScheduledLiveReminderService {
  private readonly logger = new Logger(ScheduledLiveReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebasePushService,
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
      select: { id: true, title: true, seller: { select: { userId: true } } },
    });

    for (const s of streams) {
      const claimed = await this.prisma.stream.updateMany({
        where: { id: s.id, goLiveReminderSentAt: null },
        data: { goLiveReminderSentAt: now },
      });
      if (claimed.count !== 1) continue;

      const userId = s.seller.userId;
      const devices = await this.prisma.userPushDevice.findMany({
        where: { userId },
        select: { fcmToken: true },
      });
      const sellerTokens = devices.map((d) => d.fcmToken);
      if (sellerTokens.length === 0) {
        this.logger.debug(
          `No FCM tokens for seller user ${userId}; skipping reminder for stream ${s.id}`,
        );
        continue;
      }
      try {
        await this.firebase.sendToTokens(
          sellerTokens,
          'Time to go live',
          `Your scheduled live "${s.title}" is starting.`,
          {
            type: 'SELLER_GO_LIVE_REMINDER',
            streamId: s.id,
          },
          { channelId: 'seller_go_live', tag: `go-live:${s.id}` },
        );
      } catch (e) {
        this.logger.warn(`FCM failed for stream ${s.id} (seller reminder)`, e);
      }
    }
  }
}
