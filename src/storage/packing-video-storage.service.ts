import {
  Injectable,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseStorageService } from './supabase-storage.service';

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1500;

/**
 * Packing videos are dispute evidence and must never disappear, so they are only ever stored in
 * Supabase Storage (never on the Render disk, which is wiped on every deploy/restart).
 * If Storage cannot take the file the upload fails loudly so the seller retries — the order is
 * not marked PACKED with a URL that will later 404.
 * Object keys mirror the legacy `/uploads/<key>` path so older URLs still resolve through the
 * `/uploads` fallback in main.ts.
 */
@Injectable()
export class PackingVideoStorageService {
  private readonly logger = new Logger(PackingVideoStorageService.name);

  constructor(private readonly supabase: SupabaseStorageService) {}

  /** Returns the public URL of the stored video. `key` e.g. `packing/<orderId>.mp4`. */
  async save(key: string, file: Express.Multer.File): Promise<string> {
    const objectKey = key.replace(/^\/+/, '');
    const bucket = this.supabase.publicBucket();
    const contentType = file.mimetype?.startsWith('video/')
      ? file.mimetype
      : 'video/mp4';
    const sizeMb = (file.buffer.length / (1024 * 1024)).toFixed(1);

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { publicUrl } = await this.supabase.uploadPublicObject({
          bucket,
          objectKey,
          contentType,
          bytes: file.buffer,
          cacheControlSeconds: 60 * 60 * 24 * 30,
          upsert: true,
        });
        const storedBytes = await this.supabase.headObjectSize(bucket, objectKey);
        if (storedBytes === null) {
          throw new Error('Object not found in Storage right after upload');
        }
        if (storedBytes >= 0 && storedBytes !== file.buffer.length) {
          throw new Error(
            `Stored size mismatch (expected ${file.buffer.length}, got ${storedBytes})`,
          );
        }
        if (attempt > 1) {
          this.logger.log(`Packing video ${objectKey} saved on attempt ${attempt}`);
        }
        return publicUrl;
      } catch (e) {
        lastError = e;
        if (this.isTooLarge(e)) {
          this.logger.error(
            `Packing video ${objectKey} (${sizeMb} MB) rejected by Storage size limit: ${String(e)}`,
          );
          throw new PayloadTooLargeException(
            'This packing video is too large to save. Please record a shorter video (about 2–3 minutes) and try again.',
          );
        }
        this.logger.warn(
          `Packing video upload attempt ${attempt}/${MAX_ATTEMPTS} failed (${objectKey}, ${sizeMb} MB): ${String(e)}`,
        );
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * attempt));
        }
      }
    }

    this.logger.error(
      `Packing video ${objectKey} could not be saved after ${MAX_ATTEMPTS} attempts: ${String(lastError)}`,
    );
    throw new ServiceUnavailableException(
      'We could not save your packing video right now. Your order is unchanged — please try uploading again.',
    );
  }

  private isTooLarge(e: unknown): boolean {
    const msg = String(e instanceof Error ? e.message : e);
    return /\(413\)|"statusCode":"413"|payload too large|exceeded the maximum allowed size/i.test(
      msg,
    );
  }
}
