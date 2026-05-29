import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { OrderNotificationService } from './order-notification.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [MailService, OrderNotificationService],
  exports: [MailService, OrderNotificationService],
})
export class MailModule {}
