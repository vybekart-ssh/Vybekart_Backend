import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DailyUsersReportService } from './daily-users-report.service';
import { DailyDbBackupService } from './daily-db-backup.service';

@Module({
  imports: [PrismaModule],
  providers: [DailyUsersReportService, DailyDbBackupService],
})
export class ReportsModule {}

