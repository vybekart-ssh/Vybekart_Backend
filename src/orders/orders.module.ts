import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MockDeliveryService } from './mock-delivery.service';
import { BorzoModule } from '../borzo/borzo.module';

@Module({
  imports: [PrismaModule, BorzoModule],
  controllers: [OrdersController],
  providers: [OrdersService, MockDeliveryService],
})
export class OrdersModule {}
