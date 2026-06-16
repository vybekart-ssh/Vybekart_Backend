import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DelhiveryService } from './delhivery.service';
import { AdminDelhiveryController } from './admin-delhivery.controller';

@Module({
  imports: [HttpModule],
  controllers: [AdminDelhiveryController],
  providers: [DelhiveryService],
  exports: [DelhiveryService],
})
export class DelhiveryModule {}
