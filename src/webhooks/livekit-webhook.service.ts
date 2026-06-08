import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, StreamReplayStatus } from '@prisma/client';
import { WebhookReceiver } from 'livekit-server-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { LiveKitService } from '../livekit/livekit.service';
import { StreamsService } from '../streams/streams.service';

@Injectable()
export class LivekitWebhookService {
  private readonly logger = new Logger(LivekitWebhookService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private livekit: LiveKitService,
    private streamsService: StreamsService,
  ) {}

  async handleRawPayload(
    rawBody: Buffer | undefined,
    authorization?: string,
  ): Promise<void> {
    const apiKey = this.config.get<string>('LIVEKIT_API_KEY')?.trim();
    const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET')?.trim();
    if (!apiKey || !apiSecret) {
      this.logger.warn('LiveKit webhook: API key/secret not configured');
      return;
    }

    const bodyStr = rawBody?.toString('utf8') ?? '';
    if (!bodyStr) return;

    const skip =
      this.config.get<string>('LIVEKIT_WEBHOOK_SKIP_VERIFY') === 'true' ||
      this.config.get<string>('LIVEKIT_WEBHOOK_SKIP_VERIFY') === '1';

    const receiver = new WebhookReceiver(apiKey, apiSecret);
    const event = await receiver.receive(bodyStr, authorization, skip);

    switch (event.event) {
      case 'track_published':
        await this.handleTrackPublished(event);
        break;
      case 'egress_ended':
        await this.handleEgressEnded(event);
        break;
      default:
        break;
    }
  }

  private async handleTrackPublished(event: {
    room?: { name?: string };
    track?: { type?: string | number };
  }) {
    const roomName = event.room?.name?.trim();
    if (!roomName) return;

    const trackType = event.track?.type;
    const isVideo =
      trackType === 'VIDEO' ||
      trackType === 1 ||
      trackType === '1';

    if (!isVideo) return;

    try {
      await this.streamsService.markBroadcastStarted(roomName);
    } catch (e) {
      this.logger.warn(
        `track_published broadcast mark failed for ${roomName}: ${String(e)}`,
      );
    }
  }

  private async handleEgressEnded(event: {
    egressInfo?: Parameters<LiveKitService['applyEgressWebhookResult']>[0];
  }) {
    const info = event.egressInfo;
    if (!info) return;

    const roomName = info.roomName?.trim();
    if (!roomName) return;

    const { replayUrl: egressReplayUrl, durationSec, failed } =
      this.livekit.applyEgressWebhookResult(info);

    const replayUrl =
      egressReplayUrl ||
      (!failed ? this.livekit.publicReplayUrlForStreamId(roomName) : null);

    const data: Prisma.StreamUpdateInput = { livekitEgressId: null };
    if (replayUrl) {
      data.replayUrl = replayUrl;
      if (durationSec != null) data.replayDurationSec = durationSec;
      data.replayStatus = StreamReplayStatus.READY;
    } else if (failed) {
      data.replayStatus = StreamReplayStatus.FAILED;
    }

    try {
      await this.prisma.stream.update({
        where: { id: roomName },
        data,
      });
    } catch (e) {
      this.logger.warn(
        `egress_ended DB update failed for stream ${roomName}: ${String(e)}`,
      );
    }
  }
}
