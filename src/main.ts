import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { join, normalize, sep } from 'path';
import * as fs from 'fs/promises';
import type { Request } from 'express';
import * as express from 'express';

async function bootstrap() {
  /**
   * LiveKit webhooks use `Content-Type: application/webhook+json`. Nest's default
   * `express.json()` only parses `application/json`, so the body was never read and
   * `req.rawBody` stayed empty → POST /webhooks/livekit returned 400.
   * @see https://docs.livekit.io/home/server/webhooks/
   */
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: false,
  });

  const captureRawBody = (
    req: Request & { rawBody?: Buffer },
    _res: express.Response,
    buf: Buffer,
  ) => {
    if (Buffer.isBuffer(buf)) req.rawBody = buf;
  };

  app.use(
    express.json({
      verify: captureRawBody,
      limit: '2mb',
      type: ['application/json', 'application/webhook+json'],
    }),
  );
  app.use(
    express.urlencoded({
      extended: true,
      verify: captureRawBody,
      limit: '2mb',
    }),
  );
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
      // Missing locally → optional fallback to Supabase public bucket (only if object exists).
      const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
      const bucket = (process.env.SUPABASE_PUBLIC_BUCKET ?? 'Vybekart').trim();
      if (!supabaseUrl || !bucket) {
        return res.status(404).end();
      }
      const p = (req.path || '/').toString().replace(/^\/?/, '/');
      const redirectUrl = `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}${p}`;
      try {
        const head = await fetch(redirectUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
        });
        if (head.ok) {
          res.setHeader('Cache-Control', 'public, max-age=60');
          return res.redirect(302, redirectUrl);
        }
      } catch {
        // Network / timeout — do not send clients to a broken Storage URL
      }
      return res.status(404).end();
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
