import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

type EngagementKind = 'likes' | 'comments' | 'bids';

/**
 * One-time move of likes / comments / bids that older builds kept in Redis
 * (`stream:{id}:likes|comments|bids`, 48h TTL) into Postgres. Each key is
 * deleted after import, so later boots find nothing to do.
 */
@Injectable()
export class StreamEngagementImportService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StreamEngagementImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onApplicationBootstrap() {
    void this.importAll().catch((e) =>
      this.logger.warn(`Legacy engagement import failed: ${String(e)}`),
    );
  }

  private async importAll() {
    const client = this.redis.getClient();
    let imported = 0;
    for (const kind of ['likes', 'comments', 'bids'] as const) {
      let cursor = '0';
      do {
        const [next, keys] = await client.scan(
          cursor,
          'MATCH',
          `stream:*:${kind}`,
          'COUNT',
          200,
        );
        cursor = next;
        for (const key of keys) {
          if (await this.importKey(key, kind)) imported++;
        }
      } while (cursor !== '0');
    }
    if (imported > 0) {
      this.logger.log(`Imported ${imported} legacy engagement key(s) from Redis`);
    }
  }

  private async importKey(key: string, kind: EngagementKind): Promise<boolean> {
    const streamId = key.slice('stream:'.length, -(kind.length + 1));
    if (!streamId || streamId.includes(':')) return false;
    const raw = await this.redis.get(key);
    let items: unknown[] = [];
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      /* unreadable value — drop it */
    }
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      select: { id: true },
    });
    if (stream && items.length > 0) {
      if (kind === 'likes') {
        const data = items
          .filter((u): u is string => typeof u === 'string' && u.length > 0)
          .map((userId) => ({ streamId, userId }));
        await this.prisma.streamLike.createMany({ data, skipDuplicates: true });
      } else if (kind === 'comments') {
        const data = items.flatMap((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          const text = typeof o.text === 'string' ? o.text.trim() : '';
          if (!text) return [];
          return [
            {
              streamId,
              userId: String(o.userId ?? ''),
              userName: String(o.userName ?? 'user'),
              text,
              isSeller: o.isSeller === true,
              createdAt: parseDate(o.createdAt),
            },
          ];
        });
        await this.prisma.streamComment.createMany({ data });
      } else {
        const data = items.flatMap((b) => {
          const o = (b ?? {}) as Record<string, unknown>;
          const amount = Number(o.amount);
          if (!Number.isFinite(amount) || amount <= 0) return [];
          return [
            {
              streamId,
              userId: String(o.userId ?? ''),
              userName: String(o.userName ?? 'user'),
              amount,
              createdAt: parseDate(o.createdAt),
            },
          ];
        });
        await this.prisma.streamBid.createMany({ data });
      }
    }
    await this.redis.del(key);
    return !!stream;
  }
}

function parseDate(value: unknown): Date {
  const d = typeof value === 'string' ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : new Date();
}
