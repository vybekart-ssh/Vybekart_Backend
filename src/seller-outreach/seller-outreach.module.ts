import { Module } from '@nestjs/common';
import { SellerOutreachController } from './seller-outreach.controller';
import { SellerOutreachService } from './seller-outreach.service';

@Module({
  controllers: [SellerOutreachController],
  providers: [SellerOutreachService],
  exports: [SellerOutreachService],
})
export class SellerOutreachModule {}
