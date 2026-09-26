import { Module, forwardRef } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { CartExpirySweepService } from './cart-expiry-sweep.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MockDeliveryService } from './mock-delivery.service';
import { DelhiveryModule } from '../delhivery/delhivery.module';
import { AuthModule } from '../auth/auth.module';
import { RatingsModule } from '../ratings/ratings.module';
import { AppConfigModule } from '../app-config/app-config.module';
import { MailModule } from '../mail/mail.module';
import { CouponsModule } from '../coupons/coupons.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    DelhiveryModule,
    RatingsModule,
    AppConfigModule,
    MailModule,
    forwardRef(() => CouponsModule),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, MockDeliveryService, CartExpirySweepService],
  exports: [OrdersService],
})
export class OrdersModule {}
