import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DailyUsersReportService } from './daily-users-report.service';

@Module({
  imports: [PrismaModule],
  providers: [DailyUsersReportService],
})
export class ReportsModule {}

