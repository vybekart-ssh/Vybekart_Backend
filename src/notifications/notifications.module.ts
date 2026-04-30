import { Module } from '@nestjs/common';
import { FirebasePushService } from './firebase-push.service';
import { ScheduledLiveReminderService } from './scheduled-live-reminder.service';
import { BuyerLiveBroadcastService } from './buyer-live-broadcast.service';
import { PrismaModule } from '../prisma/prisma.module';
import { Fast2SmsService } from './fast2sms.service';

@Module({
  imports: [PrismaModule],
  providers: [
    FirebasePushService,
    ScheduledLiveReminderService,
    BuyerLiveBroadcastService,
    Fast2SmsService,
  ],
  exports: [FirebasePushService, BuyerLiveBroadcastService, Fast2SmsService],
})
export class NotificationsModule {}
