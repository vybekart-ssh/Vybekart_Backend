import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DelhiveryService } from './delhivery.service';

@Module({
  imports: [HttpModule],
  providers: [DelhiveryService],
  exports: [DelhiveryService],
})
export class DelhiveryModule {}
