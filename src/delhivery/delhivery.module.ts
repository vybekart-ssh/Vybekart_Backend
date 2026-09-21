import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { DelhiveryService } from './delhivery.service';
import { DelhiveryWarehouseService } from './delhivery-warehouse.service';
import { AdminDelhiveryController } from './admin-delhivery.controller';

@Module({
  imports: [HttpModule, PrismaModule],
  controllers: [AdminDelhiveryController],
  providers: [DelhiveryService, DelhiveryWarehouseService],
  exports: [DelhiveryService, DelhiveryWarehouseService],
})
export class DelhiveryModule {}
