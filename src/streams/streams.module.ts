import { Module } from '@nestjs/common';
import { StreamsController } from './streams.controller';
import { StreamsService } from './streams.service';
import { StreamsGateway } from './streams.gateway';
import { StreamEngagementImportService } from './stream-engagement-import.service';
import { StreamDeviceRecordingService } from './stream-device-recording.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RatingsModule } from '../ratings/ratings.module';
import { OrdersModule } from '../orders/orders.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    PrismaModule,
    RatingsModule,
    OrdersModule,
    StorageModule,
  ],
  controllers: [StreamsController],
  providers: [
    StreamsService,
    StreamsGateway,
    StreamEngagementImportService,
    StreamDeviceRecordingService,
  ],
  exports: [StreamsService],
})
export class StreamsModule {}
