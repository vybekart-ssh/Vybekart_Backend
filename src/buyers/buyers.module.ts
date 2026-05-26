import { Module } from '@nestjs/common';
import { BuyersService } from './buyers.service';
import { BuyersController } from './buyers.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RatingsModule } from '../ratings/ratings.module';

@Module({
  imports: [PrismaModule, RatingsModule],
  controllers: [BuyersController],
  providers: [BuyersService],
  exports: [BuyersService],
})
export class BuyersModule {}
