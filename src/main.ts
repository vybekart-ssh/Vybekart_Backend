import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { join } from 'path';
import * as fs from 'fs/promises';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const uploadsRoot = join(process.cwd(), 'uploads');
  await fs.mkdir(uploadsRoot, { recursive: true });
  app.useStaticAssets(uploadsRoot, { prefix: '/uploads/' });

  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
  app.use((req, res, next) => {
    if (req.path === '/viewer') {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; connect-src 'self' ws: wss: https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:",
      );
    }
    next();
  });
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
void bootstrap();
