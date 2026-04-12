import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, StreamReplayStatus } from '@prisma/client';
import { WebhookReceiver } from 'livekit-server-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { LiveKitService } from '../livekit/livekit.service';

@Injectable()
export class LivekitWebhookService {
  private readonly logger = new Logger(LivekitWebhookService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private livekit: LiveKitService,
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

    if (event.event !== 'egress_ended') return;
    const info = event.egressInfo;
    if (!info) return;

    const roomName = info.roomName?.trim();
    if (!roomName) return;

    const { replayUrl, durationSec, failed } =
      this.livekit.applyEgressWebhookResult(info);

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
