import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BorzoService } from './borzo.service';

@Module({
  imports: [HttpModule],
  providers: [BorzoService],
  exports: [BorzoService],
})
export class BorzoModule {}

