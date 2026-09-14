import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SupabaseStorageService } from './supabase-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { StreamReplayStatus } from '@prisma/client';
import { ARCHIVE_RETENTION_FOREVER } from '../streams/archive-retention.util';

@Injectable()
export class StorageCleanupService {
  private readonly logger = new Logger(StorageCleanupService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseStorageService,
    private readonly prisma: PrismaService,
  ) {}

  private extractObjectKeyFromPublicUrl(url: string): string | null {
    const marker = '/storage/v1/object/public/';
    const idx = url.indexOf(marker);
    if (idx < 0) return null;
    const rest = url.slice(idx + marker.length);
    const slash = rest.indexOf('/');
    if (slash < 0) return null;
    return decodeURIComponent(rest.slice(slash + 1));
  }

  private replayBucket(): string {
    return (
      this.config.get<string>('LIVEKIT_RECORDING_S3_BUCKET')?.trim() ||
      this.supabase.publicBucket()
    );
  }

  /**
   * Delete expired archive replays based on per-stream `archiveExpiresAt`
   * (skips forever retention). Also clears DB pointers.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async deleteOldReplays(): Promise<void> {
    const enabled =
      (this.config.get<string>('CLEANUP_REPLAYS_ENABLED') ?? 'true')
        .trim()
        .toLowerCase() !== 'false';
    if (!enabled) return;

    const now = new Date();
    const expired = await this.prisma.stream.findMany({
      where: {
        isLive: false,
        endedAt: { not: null },
        replayUrl: { not: null },
        archiveRetentionHours: { not: ARCHIVE_RETENTION_FOREVER },
        archiveExpiresAt: { lte: now },
      },
      select: { id: true, replayUrl: true },
      take: 200,
    });
    if (expired.length === 0) return;

    const bucket = this.replayBucket();
    const keys: string[] = [];
    for (const s of expired) {
      const url = s.replayUrl?.trim();
      if (!url) continue;
      const key =
        this.extractObjectKeyFromPublicUrl(url) ||
        `vybekart-replays/${s.id}.mp4`;
      keys.push(key);
    }
    if (keys.length > 0) {
      await this.supabase.tryDeleteMany(bucket, keys);
    }

    const ids = expired.map((s) => s.id);
    const res = await this.prisma.stream.updateMany({
      where: { id: { in: ids } },
      data: {
        replayUrl: null,
        replayDurationSec: null,
        livekitEgressId: null,
        replayStatus: StreamReplayStatus.NONE,
      },
    });
    this.logger.log(
      `Replay cleanup: deleted ${keys.length} object(s), cleared ${res.count} stream(s)`,
    );
  }
}
