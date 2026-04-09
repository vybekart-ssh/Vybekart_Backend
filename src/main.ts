import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { join, normalize, sep } from 'path';
import * as fs from 'fs/promises';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const uploadsRoot = join(process.cwd(), 'uploads');
  await fs.mkdir(uploadsRoot, { recursive: true });

  /**
   * Serve `/uploads/**` from local disk first.
   * If the file is missing (common on ephemeral disks / after redeploy),
   * fallback to Supabase public storage (bucket) by redirecting.
   */
  app.use('/uploads', async (req, res, next) => {
    try {
      // Express gives us a decoded path. Normalize and prevent traversal.
      const reqPath = typeof req.path === 'string' ? req.path : '/';
      const safeRel = normalize(reqPath).replace(/^(\.\.(\/|\\|$))+/, '');

      // `normalize` can remove leading slash on Windows; rebuild a clean relative path.
      const rel = safeRel.startsWith(sep) ? safeRel.slice(1) : safeRel.replace(/^\/+/, '');
      const localPath = join(uploadsRoot, rel);

      // Ensure the resolved path is still under uploadsRoot.
      const normalizedRoot = normalize(uploadsRoot + sep);
      const normalizedLocal = normalize(localPath);
      if (!normalizedLocal.startsWith(normalizedRoot)) {
        return res.status(400).send('Invalid path');
      }

      // If exists locally, let static middleware serve it.
      await fs.stat(localPath);
      return next();
    } catch {
      // Missing locally → optional fallback to Supabase public bucket.
      const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
      const bucket = (process.env.SUPABASE_PUBLIC_BUCKET ?? 'Vybekart').trim();
      if (!supabaseUrl || !bucket) {
        return res.status(404).send('Not found');
      }
      const p = (req.path || '/').toString().replace(/^\/?/, '/');
      const redirectUrl = `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}${p}`;
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.redirect(302, redirectUrl);
    }
  });

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
