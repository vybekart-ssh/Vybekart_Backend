import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SupabaseStorageService } from './supabase-storage.service';
import { resolvePublicBaseUrl } from '../common/utils/public-base-url';

/**
 * Packing videos are kept permanently in Supabase Storage — the Render disk is
 * wiped on every deploy/restart. Object keys mirror the legacy `/uploads/<key>`
 * path so older URLs still resolve through the `/uploads` fallback in main.ts.
 */
@Injectable()
export class PackingVideoStorageService {
  private readonly logger = new Logger(PackingVideoStorageService.name);

  constructor(
    private readonly supabase: SupabaseStorageService,
    private readonly config: ConfigService,
  ) {}

  /** Returns the public URL of the stored video. `key` e.g. `packing/<orderId>.mp4`. */
  async save(key: string, file: Express.Multer.File): Promise<string> {
    const objectKey = key.replace(/^\/+/, '');
    const contentType = file.mimetype?.startsWith('video/')
      ? file.mimetype
      : 'video/mp4';
    try {
      const { publicUrl } = await this.supabase.uploadPublicObject({
        bucket: this.supabase.publicBucket(),
        objectKey,
        contentType,
        bytes: file.buffer,
        cacheControlSeconds: 60 * 60 * 24 * 30,
        upsert: true,
      });
      return publicUrl;
    } catch (e) {
      this.logger.error(
        `Packing video upload to Supabase failed (${objectKey}); saved on local disk only, which is not persistent: ${String(e)}`,
      );
      const dest = path.join(process.cwd(), 'uploads', objectKey);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, file.buffer);
      return `${resolvePublicBaseUrl(this.config)}/uploads/${objectKey}`;
    }
  }
}
