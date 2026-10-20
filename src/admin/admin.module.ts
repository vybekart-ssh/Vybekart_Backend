import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SellersModule } from '../sellers/sellers.module';
import { AppConfigModule } from '../app-config/app-config.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { RatingsModule } from '../ratings/ratings.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminInsightsService } from './insights/admin-insights.service';
import { AdminReportService } from './insights/admin-report.service';

@Module({
  imports: [
    PrismaModule,
    SellersModule,
    AppConfigModule,
    RatingsModule,
    StorageModule,
    NotificationsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminInsightsService, AdminReportService],
})
export class AdminModule {}
