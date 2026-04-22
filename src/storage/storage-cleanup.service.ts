import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SupabaseStorageService } from './supabase-storage.service';

@Injectable()
export class StorageCleanupService {
  private readonly logger = new Logger(StorageCleanupService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseStorageService,
  ) {}

  /**
   * Delete replay MP4s older than 24 hours to avoid filling Storage.
   * LiveKit writes: `vybekart-replays/{streamId}.mp4` into LIVEKIT_RECORDING_S3_BUCKET.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async deleteOldReplays(): Promise<void> {
    const enabled =
      (this.config.get<string>('CLEANUP_REPLAYS_ENABLED') ?? 'true')
        .trim()
        .toLowerCase() !== 'false';
    if (!enabled) return;

    const bucket =
      this.config.get<string>('LIVEKIT_RECORDING_S3_BUCKET')?.trim() ||
      this.supabase.publicBucket();
    const prefix = 'vybekart-replays/';
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    let offset = 0;
    let deleted = 0;
    for (let page = 0; page < 200; page++) {
      const rows = await this.supabase.listObjects({
        bucket,
        prefix,
        limit: 100,
        offset,
        sortBy: { column: 'created_at', order: 'asc' },
      });
      if (rows.length === 0) break;

      const toDelete: string[] = [];
      for (const r of rows) {
        const created = r.created_at ? Date.parse(r.created_at) : NaN;
        if (!Number.isFinite(created)) continue;
        if (created < cutoff) {
          toDelete.push(prefix + r.name);
        }
      }

      if (toDelete.length > 0) {
        // Supabase limit: 1000 per call; we're deleting <=100.
        await this.supabase.tryDeleteMany(bucket, toDelete);
        deleted += toDelete.length;
      } else {
        // Sorted asc by created_at; if the oldest on this page isn't deletable, nothing after will be.
        break;
      }

      offset += rows.length;
    }

    if (deleted > 0) {
      this.logger.log(`Replay cleanup: deleted ${deleted} old replay(s)`);
    }
  }
}

