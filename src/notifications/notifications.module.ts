import { Module } from '@nestjs/common';
import { FirebasePushService } from './firebase-push.service';
import { ScheduledLiveReminderService } from './scheduled-live-reminder.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [FirebasePushService, ScheduledLiveReminderService],
  exports: [FirebasePushService],
})
export class NotificationsModule {}
