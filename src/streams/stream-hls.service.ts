import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StreamReplayStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { HlsCompleteDto, HlsStatusDto, HlsUploadSessionDto } from './dto/stream-hls.dto';

export const HLS_STATUS = {
  NONE: 'NONE',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const;

export type HlsSource = 'DEVICE' | 'ADMIN_TOOL';

/** Supabase TUS requires 6 MB chunks (last chunk may be smaller). */
const TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024 * 1024;

export function hlsContentType(name: string): string {
  if (name.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (name.endsWith('.m4s')) return 'video/iso.segment';
  return 'video/mp4';
}

/**
 * Adaptive (HLS) copies of archived lives, made by the seller's phone after the live or by the
 * admin PC tool. Files go to `vybekart-replays/hls/<streamId>/`; `Stream.replayUrl` (the original
 * HD MP4) is never touched.
 */
@Injectable()
export class StreamHlsService {
  private readonly logger = new Logger(StreamHlsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: SupabaseStorageService,
  ) {}

  private bucket(): string {
    return (
      this.config.get<string>('LIVEKIT_RECORDING_S3_BUCKET')?.trim() ||
      this.storage.publicBucket()
    );
  }

  objectKey(streamId: string, name: string): string {
    return `vybekart-replays/hls/${streamId}/${name}`;
  }

  /** Throws unless the stream exists, has ended with a ready original, and (for sellers) is theirs. */
  private async loadStream(streamId: string, sellerUserId?: string) {
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      select: {
        id: true,
        endedAt: true,
        replayUrl: true,
        replayStatus: true,
        hlsStatus: true,
        hlsUrl: true,
        seller: { select: { userId: true } },
      },
    });
    if (!stream) throw new NotFoundException('This live stream no longer exists.');
    if (sellerUserId && stream.seller.userId !== sellerUserId) {
      throw new ForbiddenException('You can only upload videos for your own lives.');
    }
    if (!stream.endedAt) throw new BadRequestException('This live has not ended yet.');
    return stream;
  }

  private assertFiles(files: { name: string; sizeBytes: number }[]) {
    const names = new Set<string>();
    let total = 0;
    for (const f of files) {
      if (names.has(f.name)) throw new BadRequestException(`Duplicate file ${f.name}`);
      names.add(f.name);
      total += f.sizeBytes;
    }
    if (total > MAX_TOTAL_BYTES) throw new BadRequestException('These video files are too large.');
  }

  async createUploadSession(streamId: string, dto: HlsUploadSessionDto, sellerUserId?: string) {
    await this.loadStream(streamId, sellerUserId);
    this.assertFiles(dto.files);
    const endpoint = this.storage.signedResumableUploadEndpoint();
    if (!endpoint) {
      throw new ServiceUnavailableException('Video uploads are not configured right now. Try again later.');
    }
    const bucket = this.bucket();
    let items: { name: string; objectName: string; signature: string; contentType: string }[];
    try {
      items = await Promise.all(
        dto.files.map(async (f) => {
          const objectName = this.objectKey(streamId, f.name);
          const signature = await this.storage.createSignedUploadToken({
            bucket,
            objectKey: objectName,
            upsert: true,
          });
          return { name: f.name, objectName, signature, contentType: hlsContentType(f.name) };
        }),
      );
    } catch (e) {
      this.logger.warn(`HLS signed upload tokens failed for ${streamId}: ${String(e)}`);
      throw new BadGatewayException('Could not start the upload. It will retry automatically.');
    }
    await this.prisma.stream.update({
      where: { id: streamId },
      data: { hlsStatus: HLS_STATUS.PROCESSING, hlsError: null, hlsUpdatedAt: new Date() },
    });
    return { endpoint, bucket, chunkSizeBytes: TUS_CHUNK_SIZE_BYTES, files: items };
  }

  async complete(streamId: string, dto: HlsCompleteDto, source: HlsSource, sellerUserId?: string) {
    await this.loadStream(streamId, sellerUserId);
    this.assertFiles(dto.files);
    if (!dto.files.some((f) => f.name === dto.master)) {
      throw new BadRequestException('The master playlist must be one of the uploaded files.');
    }
    const bucket = this.bucket();
    for (const f of dto.files) {
      let size: number | null;
      try {
        size = await this.storage.headObjectSize(bucket, this.objectKey(streamId, f.name));
      } catch (e) {
        this.logger.warn(`HLS head ${f.name} failed for ${streamId}: ${String(e)}`);
        throw new BadGatewayException('Could not confirm the uploaded files yet. Retrying automatically.');
      }
      if (size == null) throw new BadRequestException(`${f.name} was not uploaded.`);
      if (size > 0 && size !== f.sizeBytes) throw new BadRequestException(`${f.name} is incomplete.`);
    }
    const hlsUrl = this.storage.buildPublicUrl(bucket, this.objectKey(streamId, dto.master));
    if (!hlsUrl) throw new ServiceUnavailableException('Video storage is not configured.');
    await this.prisma.stream.update({
      where: { id: streamId },
      data: {
        hlsUrl,
        hlsStatus: HLS_STATUS.READY,
        hlsSource: source,
        hlsError: null,
        hlsUpdatedAt: new Date(),
      },
    });
    this.logger.log(`HLS ready for stream ${streamId} (${source}, ${dto.files.length} files)`);
    return { streamId, hlsUrl, hlsStatus: HLS_STATUS.READY };
  }

  async reportStatus(streamId: string, dto: HlsStatusDto, sellerUserId?: string) {
    const stream = await this.loadStream(streamId, sellerUserId);
    // A finished HLS copy is never downgraded by a late failure report.
    if (stream.hlsStatus === HLS_STATUS.READY && stream.hlsUrl) {
      return { streamId, hlsUrl: stream.hlsUrl, hlsStatus: stream.hlsStatus };
    }
    await this.prisma.stream.update({
      where: { id: streamId },
      data: {
        hlsStatus: dto.status,
        hlsError: dto.status === 'FAILED' ? dto.error?.trim() || 'Unknown error' : null,
        hlsUpdatedAt: new Date(),
      },
    });
    return { streamId, hlsUrl: null, hlsStatus: dto.status };
  }

  /** Archives whose original is ready but have no adaptive copy yet (oldest first), for the PC tool. */
  async listPending(limit = 50) {
    const rows = await this.prisma.stream.findMany({
      where: {
        isLive: false,
        endedAt: { not: null },
        replayStatus: StreamReplayStatus.READY,
        replayUrl: { not: null },
        hlsStatus: { not: HLS_STATUS.READY },
      },
      orderBy: { endedAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 200),
      select: {
        id: true,
        title: true,
        replayUrl: true,
        replayDurationSec: true,
        hlsStatus: true,
        hlsSource: true,
        hlsError: true,
        hlsUpdatedAt: true,
        endedAt: true,
        seller: { select: { businessName: true } },
      },
    });
    return {
      items: rows.map((r) => ({
        streamId: r.id,
        title: r.title,
        sellerName: r.seller?.businessName ?? null,
        replayUrl: r.replayUrl,
        durationSec: r.replayDurationSec,
        endedAt: r.endedAt?.toISOString() ?? null,
        hlsStatus: r.hlsStatus,
        hlsSource: r.hlsSource,
        hlsError: r.hlsError,
        hlsUpdatedAt: r.hlsUpdatedAt?.toISOString() ?? null,
      })),
    };
  }
}
