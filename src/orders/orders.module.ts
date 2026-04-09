import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MockDeliveryService } from './mock-delivery.service';
import { BorzoModule } from '../borzo/borzo.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule, BorzoModule],
  controllers: [OrdersController],
  providers: [OrdersService, MockDeliveryService],
})
export class OrdersModule {}
