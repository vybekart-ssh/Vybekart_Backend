import { Module } from '@nestjs/common';
import { StreamsController } from './streams.controller';
import { StreamsService } from './streams.service';
import { StreamsGateway } from './streams.gateway';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RatingsModule } from '../ratings/ratings.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [AuthModule, NotificationsModule, PrismaModule, RatingsModule, OrdersModule],
  controllers: [StreamsController],
  providers: [StreamsService, StreamsGateway],
})
export class StreamsModule {}
