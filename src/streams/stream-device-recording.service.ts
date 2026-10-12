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
import {
  DeviceRecordingStatus,
  StreamReplaySource,
  StreamReplayStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import {
  DeviceRecordingCompleteDto,
  DeviceRecordingStatusDto,
  DeviceRecordingUploadSessionDto,
} from './dto/device-recording.dto';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024 * 1024;
/** Supabase TUS requires 6 MB chunks (last chunk may be smaller). */
const TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024;
const SIGNED_UPLOAD_TTL_SECONDS = 2 * 60 * 60;

/**
 * Seller-phone HD recording: the app records locally during the live and uploads the MP4
 * straight to Supabase (signed TUS) afterwards. LiveKit egress stays as the fallback replay.
 */
@Injectable()
export class StreamDeviceRecordingService {
  private readonly logger = new Logger(StreamDeviceRecordingService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private storage: SupabaseStorageService,
  ) {}

  private bucket(): string {
    return (
      this.config.get<string>('LIVEKIT_RECORDING_S3_BUCKET')?.trim() ||
      this.storage.publicBucket()
    );
  }

  private maxBytes(): number {
    const raw = Number(this.config.get('DEVICE_RECORDING_MAX_BYTES'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BYTES;
  }

  private objectKey(streamId: string): string {
    return `vybekart-replays/device/${streamId}.mp4`;
  }

  private async loadOwnedStream(streamId: string, userId: string) {
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      select: {
        id: true,
        startedAt: true,
        broadcastStartedAt: true,
        endedAt: true,
        replayUrl: true,
        replayStatus: true,
        replaySource: true,
        deviceRecordingStatus: true,
        deviceRecordingObjectKey: true,
        seller: { select: { userId: true } },
      },
    });
    if (!stream) throw new NotFoundException('This live stream no longer exists.');
    if (stream.seller.userId !== userId) {
      throw new ForbiddenException('You can only upload recordings for your own lives.');
    }
    return stream;
  }

  private statusPayload(stream: {
    id: string;
    replayUrl: string | null;
    replayStatus: StreamReplayStatus;
    replaySource: StreamReplaySource | null;
    deviceRecordingStatus: DeviceRecordingStatus;
  }) {
    return {
      streamId: stream.id,
      replayUrl: stream.replayUrl,
      replayStatus: stream.replayStatus,
      replaySource: stream.replaySource,
      deviceRecordingStatus: stream.deviceRecordingStatus,
    };
  }

  async createUploadSession(
    streamId: string,
    userId: string,
    dto: DeviceRecordingUploadSessionDto,
  ) {
    const stream = await this.loadOwnedStream(streamId, userId);
    if (stream.deviceRecordingStatus === DeviceRecordingStatus.READY) {
      return { alreadyUploaded: true as const, ...this.statusPayload(stream) };
    }
    if (dto.sizeBytes > this.maxBytes()) {
      const gb = (this.maxBytes() / 1024 ** 3).toFixed(1);
      throw new BadRequestException(
        `This recording is larger than the ${gb} GB upload limit. Please contact support.`,
      );
    }

    const endpoint = this.storage.signedResumableUploadEndpoint();
    if (!endpoint) {
      throw new ServiceUnavailableException(
        'Video uploads are not configured right now. Your recording is safe on your phone — try again later.',
      );
    }

    const bucket = this.bucket();
    const objectName = this.objectKey(streamId);
    let signature: string;
    try {
      signature = await this.storage.createSignedUploadToken({
        bucket,
        objectKey: objectName,
        upsert: true,
      });
    } catch (e) {
      this.logger.warn(`Signed upload token failed for ${streamId}: ${String(e)}`);
      throw new BadGatewayException(
        'Could not start the video upload. Your recording is safe on your phone — we will retry automatically.',
      );
    }

    await this.prisma.stream.update({
      where: { id: streamId },
      data: {
        deviceRecordingStatus: DeviceRecordingStatus.UPLOADING,
        deviceRecordingObjectKey: objectName,
        deviceRecordingBytes: dto.sizeBytes,
        deviceRecordingError: null,
        deviceRecordingUpdatedAt: new Date(),
      },
    });

    return {
      alreadyUploaded: false as const,
      endpoint,
      signature,
      bucket,
      objectName,
      contentType: 'video/mp4',
      chunkSizeBytes: TUS_CHUNK_SIZE_BYTES,
      expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
    };
  }

  async completeUpload(
    streamId: string,
    userId: string,
    dto: DeviceRecordingCompleteDto,
  ) {
    const stream = await this.loadOwnedStream(streamId, userId);
    if (stream.deviceRecordingStatus === DeviceRecordingStatus.READY && stream.replayUrl) {
      return this.statusPayload(stream);
    }
    const bucket = this.bucket();
    const objectName = stream.deviceRecordingObjectKey || this.objectKey(streamId);

    let remoteSize: number | null;
    try {
      remoteSize = await this.storage.headObjectSize(bucket, objectName);
    } catch (e) {
      this.logger.warn(`Head device recording failed for ${streamId}: ${String(e)}`);
      throw new BadGatewayException(
        'Could not confirm the uploaded video yet. We will retry automatically.',
      );
    }
    if (remoteSize == null) {
      throw new BadRequestException(
        'The uploaded video was not found. The upload will restart automatically.',
      );
    }
    if (remoteSize > 0 && remoteSize !== dto.sizeBytes) {
      throw new BadRequestException(
        'The uploaded video is incomplete. The upload will resume automatically.',
      );
    }

    const replayUrl = this.storage.buildPublicUrl(bucket, objectName);
    if (!replayUrl) {
      throw new ServiceUnavailableException('Video storage is not configured.');
    }

    const updated = await this.prisma.stream.update({
      where: { id: streamId },
      data: {
        replayUrl,
        replayStatus: StreamReplayStatus.READY,
        replaySource: StreamReplaySource.DEVICE,
        ...(dto.durationSec != null && dto.durationSec > 0
          ? { replayDurationSec: dto.durationSec }
          : {}),
        deviceRecordingStatus: DeviceRecordingStatus.READY,
        deviceRecordingObjectKey: objectName,
        deviceRecordingBytes: dto.sizeBytes,
        deviceRecordingError: null,
        deviceRecordingUpdatedAt: new Date(),
      },
      select: {
        id: true,
        replayUrl: true,
        replayStatus: true,
        replaySource: true,
        deviceRecordingStatus: true,
      },
    });
    this.logger.log(
      `Device HD recording ready for stream ${streamId} (${dto.sizeBytes} bytes)`,
    );
    return this.statusPayload(updated);
  }

  async reportStatus(
    streamId: string,
    userId: string,
    dto: DeviceRecordingStatusDto,
  ) {
    const stream = await this.loadOwnedStream(streamId, userId);
    if (stream.deviceRecordingStatus === DeviceRecordingStatus.READY) {
      return this.statusPayload(stream);
    }
    const updated = await this.prisma.stream.update({
      where: { id: streamId },
      data: {
        deviceRecordingStatus: DeviceRecordingStatus[dto.status],
        deviceRecordingError:
          dto.status === 'FAILED' ? dto.error?.trim() || 'Unknown error' : null,
        deviceRecordingUpdatedAt: new Date(),
      },
      select: {
        id: true,
        replayUrl: true,
        replayStatus: true,
        replaySource: true,
        deviceRecordingStatus: true,
      },
    });
    return this.statusPayload(updated);
  }
}
