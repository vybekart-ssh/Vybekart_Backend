import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DailyUsersReportService } from './daily-users-report.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const svc = app.get(DailyUsersReportService);
    await svc.sendDailyUsersReport();
  } finally {
    await app.close();
  }
}

void main().catch((err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(msg);
  process.exitCode = 1;
});

