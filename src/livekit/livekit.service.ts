import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccessToken,
  EgressClient,
  RoomServiceClient,
  VideoGrant,
} from 'livekit-server-sdk';
import {
  EncodedFileOutput,
  EncodedFileType,
  EncodingOptionsPreset,
  EgressInfo,
  EgressStatus,
  S3Upload,
} from '@livekit/protocol';
import { normalizeLiveKitApiUrl } from './livekit-network.util';

/**
 * Supabase Storage S3 protocol endpoint.
 * @see https://supabase.com/docs/guides/storage/s3/authentication
 */
export function supabaseStorageS3EndpointFromSupabaseUrl(
  supabaseUrl: string,
): string | null {
  try {
    const trimmed = supabaseUrl.trim().replace(/\/$/, '');
    const u = new URL(trimmed);
    const host = u.hostname;
    const m = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    if (!m) return null;
    return `https://${m[1]}.storage.supabase.co/storage/v1/s3`;
  } catch {
    return null;
  }
}

function durationSecondsFromFileInfo(duration: bigint): number | undefined {
  if (duration === 0n) return undefined;
  const n = Number(duration);
  if (n > 1_000_000) return Math.round(n / 1_000_000_000);
  return Math.round(n);
}

@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);
  private roomService: RoomServiceClient | null = null;
  private egressClient: EgressClient | null = null;
  private apiKey: string | null = null;
  private apiSecret: string | null = null;
  private url: string | null = null;

  constructor(private config: ConfigService) {
    const rawUrl = this.config.get<string>('LIVEKIT_URL')?.trim();
    const apiKey = this.config.get<string>('LIVEKIT_API_KEY')?.trim();
    const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET')?.trim();
    if (rawUrl && apiKey && apiSecret) {
      const url = normalizeLiveKitApiUrl(rawUrl);
      this.url = url;
      this.apiKey = apiKey;
      this.apiSecret = apiSecret;
      this.roomService = new RoomServiceClient(url, apiKey, apiSecret);
      this.egressClient = new EgressClient(url, apiKey, apiSecret);
      if (url !== rawUrl.replace(/\/$/, '')) {
        this.logger.log(`LIVEKIT_URL normalized for API: ${url}`);
      }
    }
  }

  isConfigured(): boolean {
    return !!(this.url && this.apiKey && this.apiSecret && this.roomService);
  }

  /** Use Supabase Storage (S3 protocol) + public replay URLs under SUPABASE_URL. */
  private recordingUsesSupabase(): boolean {
    const v = this.config.get<string>('LIVEKIT_RECORDING_USE_SUPABASE')?.trim();
    return v === 'true' || v === '1';
  }

  private getEgressRecordingS3Params(): {
    bucket: string;
    region: string;
    access: string;
    secret: string;
    endpoint: string;
    forcePathStyle: boolean;
  } | null {
    const bucket = this.config.get<string>('LIVEKIT_RECORDING_S3_BUCKET')?.trim();
    const access =
      this.config.get<string>('LIVEKIT_RECORDING_S3_ACCESS_KEY')?.trim() ||
      this.config.get<string>('AWS_ACCESS_KEY_ID')?.trim();
    const secret =
      this.config.get<string>('LIVEKIT_RECORDING_S3_SECRET')?.trim() ||
      this.config.get<string>('AWS_SECRET_ACCESS_KEY')?.trim();
    if (!bucket || !access || !secret) return null;

    const useSb = this.recordingUsesSupabase();
    let endpoint =
      this.config.get<string>('LIVEKIT_RECORDING_S3_ENDPOINT')?.trim() || '';
    if (!endpoint && useSb) {
      const supabaseUrl = this.config.get<string>('SUPABASE_URL')?.trim();
      if (supabaseUrl) {
        endpoint = supabaseStorageS3EndpointFromSupabaseUrl(supabaseUrl) || '';
      }
    }
    if (useSb && !endpoint) {
      this.logger.warn(
        'Supabase replay recording: set SUPABASE_URL or LIVEKIT_RECORDING_S3_ENDPOINT',
      );
      return null;
    }

    const regionCfg = this.config.get<string>('LIVEKIT_RECORDING_S3_REGION')?.trim();
    const region = regionCfg || (useSb ? 'local' : 'us-east-1');

    const fs = this.config.get<string>('LIVEKIT_RECORDING_S3_FORCE_PATH_STYLE');
    let forcePathStyle = useSb;
    if (fs === 'true' || fs === '1') forcePathStyle = true;
    if (fs === 'false' || fs === '0') forcePathStyle = false;

    return { bucket, region, access, secret, endpoint, forcePathStyle };
  }

  isReplayRecordingConfigured(): boolean {
    if (!this.isConfigured() || !this.egressClient) return false;
    return this.getEgressRecordingS3Params() !== null;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new BadRequestException(
        'LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.',
      );
    }
  }

  getLiveKitUrl(): string {
    this.assertConfigured();
    return this.url!;
  }

  getWebSocketUrl(): string {
    this.assertConfigured();
    const u = this.url!;
    if (u.startsWith('https://')) return u.replace('https://', 'wss://');
    if (u.startsWith('http://')) return u.replace('http://', 'ws://');
    return u;
  }

  getClientUrl(): string {
    this.assertConfigured();
    const u = this.url!;
    if (u.includes(':7880')) return u.replace(':7880', ':7881');
    return u;
  }

  async createRoom(roomName: string, metadata?: string): Promise<void> {
    this.assertConfigured();
    await this.roomService!.createRoom({
      name: roomName,
      emptyTimeout: 10 * 60,
      maxParticipants: 500,
      metadata: metadata ?? undefined,
    });
  }

  async deleteRoom(roomName: string): Promise<void> {
    if (!this.roomService) return;
    try {
      await this.roomService.deleteRoom(roomName);
    } catch {
      // Room may already be gone
    }
  }

  async createToken(
    roomName: string,
    identity: string,
    options: { canPublish: boolean; canSubscribe: boolean },
  ): Promise<string> {
    this.assertConfigured();

    const at = new AccessToken(this.apiKey!, this.apiSecret!, {
      identity,
      ttl: '6h',
    });

    const grant: VideoGrant = {
      roomJoin: true,
      room: roomName,
      canPublish: options.canPublish,
      canSubscribe: options.canSubscribe,
    };
    at.addGrant(grant);

    return await at.toJwt();
  }

  async createPublisherToken(
    roomName: string,
    identity: string,
  ): Promise<string> {
    return this.createToken(roomName, identity, {
      canPublish: true,
      canSubscribe: true,
    });
  }

  async createSubscriberToken(
    roomName: string,
    identity: string,
  ): Promise<string> {
    return this.createToken(roomName, identity, {
      canPublish: false,
      canSubscribe: true,
    });
  }

  /** Public object URL when using Supabase Storage + a public bucket. */
  private buildSupabasePublicObjectUrl(objectKey: string): string | null {
    const key = objectKey.replace(/^\/+/, '');
    if (!key) return null;
    const base = this.config.get<string>('SUPABASE_URL')?.trim()?.replace(/\/$/, '');
    const bucket = this.config.get<string>('LIVEKIT_RECORDING_S3_BUCKET')?.trim();
    if (!base || !bucket) return null;
    // Bucket name is a path segment; object key may contain slashes — do not encode the key.
    return `${base}/storage/v1/object/public/${bucket}/${key}`;
  }

  private supabasePublicReplayUrl(objectPath: string): string | null {
    return this.buildSupabasePublicObjectUrl(objectPath);
  }

  /**
   * LiveKit often finishes the MP4 upload after `stopEgress` returns, and `fileResults` may be empty
   * until `egress_ended`. We always write to `vybekart-replays/{streamId}.mp4` — use that so
   * `replayUrl` is set in Postgres even when the webhook is late or missing file metadata.
   */
  publicReplayUrlForStreamId(streamId: string): string | null {
    if (!this.recordingUsesSupabase()) return null;
    const id = streamId.trim();
    if (!id) return null;
    return this.buildSupabasePublicObjectUrl(`vybekart-replays/${id}.mp4`);
  }

  private extractReplayFromEgress(info: EgressInfo): {
    replayUrl?: string;
    durationSec?: number;
  } {
    const f = info.fileResults?.[0];
    const durationSec = f ? durationSecondsFromFileInfo(f.duration) : undefined;

    // Always emit a browser-playable public URL for Supabase — never store internal S3 endpoints.
    if (this.recordingUsesSupabase()) {
      const roomName = info.roomName?.trim();
      const fn = f?.filename?.trim();
      const objectKey =
        fn ||
        (roomName ? `vybekart-replays/${roomName}.mp4` : null);
      const pub = objectKey ? this.supabasePublicReplayUrl(objectKey) : null;
      if (pub) return { replayUrl: pub, durationSec };
      return { durationSec };
    }

    if (!f?.location) return { durationSec };
    return {
      replayUrl: f.location,
      durationSec,
    };
  }

  /**
   * Start MP4 room-composite egress to S3-compatible storage. `roomName` equals stream id.
   */
  async startRoomRecording(roomName: string): Promise<string | null> {
    if (!this.isReplayRecordingConfigured() || !this.egressClient) {
      return null;
    }
    this.assertConfigured();

    const params = this.getEgressRecordingS3Params()!;
    const filepath = `vybekart-replays/${roomName}.mp4`;

    const s3 = new S3Upload({
      accessKey: params.access,
      secret: params.secret,
      region: params.region,
      bucket: params.bucket,
      endpoint: params.endpoint,
      forcePathStyle: params.forcePathStyle,
    });

    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath,
      output: { case: 's3', value: s3 },
    });

    try {
      const info = await this.egressClient.startRoomCompositeEgress(
        roomName,
        output,
        { encodingOptions: EncodingOptionsPreset.PORTRAIT_H264_720P_30 },
      );
      const id = info.egressId;
      if (!id) {
        this.logger.warn(`startRoomRecording: missing egressId for room ${roomName}`);
        return null;
      }
      this.logger.log(`Started room recording egress ${id} for room ${roomName}`);
      return id;
    } catch (e) {
      this.logger.warn(
        `startRoomRecording failed for ${roomName}: ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  async stopRoomRecording(egressId: string): Promise<{
    replayUrl?: string;
    durationSec?: number;
    failed: boolean;
  }> {
    if (!this.egressClient) {
      return { failed: true };
    }
    try {
      const info = await this.egressClient.stopEgress(egressId);
      const failed =
        info.status === EgressStatus.EGRESS_FAILED ||
        info.status === EgressStatus.EGRESS_ABORTED ||
        !!info.error?.trim();
      const { replayUrl, durationSec } = this.extractReplayFromEgress(info);
      return { replayUrl, durationSec, failed };
    } catch (e) {
      this.logger.warn(
        `stopRoomRecording ${egressId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { failed: true };
    }
  }

  applyEgressWebhookResult(info: EgressInfo): {
    replayUrl?: string;
    durationSec?: number;
    failed: boolean;
  } {
    const failed =
      info.status === EgressStatus.EGRESS_FAILED ||
      info.status === EgressStatus.EGRESS_ABORTED ||
      !!info.error?.trim();
    const { replayUrl, durationSec } = this.extractReplayFromEgress(info);
    return { replayUrl, durationSec, failed };
  }
}
