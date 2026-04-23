import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SupabaseStorageService } from './supabase-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { StreamReplayStatus } from '@prisma/client';

@Injectable()
export class StorageCleanupService {
  private readonly logger = new Logger(StorageCleanupService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseStorageService,
    private readonly prisma: PrismaService,
  ) {}

  private extractStreamIdFromReplayKey(objectKey: string): string | null {
    // Expect: vybekart-replays/{streamId}.mp4
    const name = objectKey.split('/').pop() ?? '';
    const base = name.replace(/\.mp4$/i, '');
    // Stream IDs are UUIDs in our DB; validate shape to avoid accidental updates.
    const uuidV4 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidV4.test(base) ? base : null;
  }

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
    const deletedStreamIds = new Set<string>();
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
          const key = prefix + r.name;
          toDelete.push(key);
          const sid = this.extractStreamIdFromReplayKey(key);
          if (sid) deletedStreamIds.add(sid);
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

    // Important: Clearing Storage objects alone leaves stale `replayUrl` in Postgres,
    // which keeps "Archived lives" visible while playback fails. Clear the DB pointer too.
    const ids = Array.from(deletedStreamIds);
    if (ids.length > 0) {
      const res = await this.prisma.stream.updateMany({
        where: {
          id: { in: ids },
          replayUrl: { not: null },
        },
        data: {
          replayUrl: null,
          replayDurationSec: null,
          livekitEgressId: null,
          replayStatus: StreamReplayStatus.NONE,
        },
      });
      if (res.count > 0) {
        this.logger.log(`Replay cleanup: cleared replayUrl for ${res.count} stream(s)`);
      }
    }
  }
}

