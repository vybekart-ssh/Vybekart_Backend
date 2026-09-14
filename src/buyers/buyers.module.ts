import { Module } from '@nestjs/common';
import { BuyersService } from './buyers.service';
import { BuyersController } from './buyers.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RatingsModule } from '../ratings/ratings.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, RatingsModule, StorageModule],
  controllers: [BuyersController],
  providers: [BuyersService],
  exports: [BuyersService],
})
export class BuyersModule {}
