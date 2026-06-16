import { Module } from '@nestjs/common';
import { SellerEmailService } from './seller-email.service';
import { AdminSellerEmailsController } from './admin-seller-emails.controller';

@Module({
  controllers: [AdminSellerEmailsController],
  providers: [SellerEmailService],
  exports: [SellerEmailService],
})
export class SellerEmailsModule {}
