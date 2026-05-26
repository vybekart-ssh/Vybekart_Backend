import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SellersModule } from '../sellers/sellers.module';
import { AppConfigModule } from '../app-config/app-config.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { RatingsModule } from '../ratings/ratings.module';

@Module({
  imports: [PrismaModule, SellersModule, AppConfigModule, RatingsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
