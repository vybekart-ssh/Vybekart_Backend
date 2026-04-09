import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MockDeliveryService } from './mock-delivery.service';
<<<<<<< HEAD
import { BorzoModule } from '../borzo/borzo.module';

@Module({
  imports: [PrismaModule, BorzoModule],
=======
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
>>>>>>> d6a25c0f08f1171e7dc99d62e6c10bf7d4e6bc48
  controllers: [OrdersController],
  providers: [OrdersService, MockDeliveryService],
})
export class OrdersModule {}
