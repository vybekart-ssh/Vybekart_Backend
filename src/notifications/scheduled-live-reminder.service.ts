import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FirebasePushService } from './firebase-push.service';

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
      include: { seller: true },
    });

    for (const s of streams) {
      const userId = s.seller.userId;
      const devices = await this.prisma.userPushDevice.findMany({
        where: { userId },
        select: { fcmToken: true },
      });
      const tokens = devices.map((d) => d.fcmToken);

      if (tokens.length > 0) {
        try {
          await this.firebase.sendToTokens(
            tokens,
            'Time to go live',
            `Your scheduled live "${s.title}" is starting.`,
            {
              type: 'SELLER_GO_LIVE_REMINDER',
              streamId: s.id,
            },
          );
        } catch (e) {
          this.logger.warn(`FCM failed for stream ${s.id}`, e);
          continue;
        }
      } else {
        this.logger.debug(
          `No FCM tokens for seller user ${userId}; skipping push for stream ${s.id}`,
        );
      }

      await this.prisma.stream.update({
        where: { id: s.id },
        data: { goLiveReminderSentAt: now },
      });
    }
  }
}
