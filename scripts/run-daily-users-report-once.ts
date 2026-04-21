import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DailyUsersReportService } from '../src/reports/daily-users-report.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  const svc = app.get(DailyUsersReportService);
  await svc.sendDailyUsersReport();

  await app.close();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

