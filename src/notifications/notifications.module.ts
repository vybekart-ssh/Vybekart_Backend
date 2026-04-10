import { Module } from '@nestjs/common';
import { FirebasePushService } from './firebase-push.service';
import { ScheduledLiveReminderService } from './scheduled-live-reminder.service';
import { BuyerLiveBroadcastService } from './buyer-live-broadcast.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [
    FirebasePushService,
    ScheduledLiveReminderService,
    BuyerLiveBroadcastService,
  ],
  exports: [FirebasePushService, BuyerLiveBroadcastService],
})
export class NotificationsModule {}
