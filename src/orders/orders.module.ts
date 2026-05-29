import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { CartExpirySweepService } from './cart-expiry-sweep.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MockDeliveryService } from './mock-delivery.service';
import { BorzoModule } from '../borzo/borzo.module';
import { AuthModule } from '../auth/auth.module';
import { RatingsModule } from '../ratings/ratings.module';

@Module({
  imports: [PrismaModule, AuthModule, BorzoModule, RatingsModule],
  controllers: [OrdersController],
  providers: [OrdersService, MockDeliveryService, CartExpirySweepService],
  exports: [OrdersService],
})
export class OrdersModule {}
