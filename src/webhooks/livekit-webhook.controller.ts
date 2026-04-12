import {
  Controller,
  HttpCode,
  Post,
  Req,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common/interfaces';
import type { Request } from 'express';
import { LivekitWebhookService } from './livekit-webhook.service';

@Controller('webhooks')
export class LivekitWebhookController {
  constructor(private readonly livekitWebhook: LivekitWebhookService) {}

  @Post('livekit')
  @SkipThrottle()
  @HttpCode(200)
  async livekit(
    @Req() req: RawBodyRequest<Request>,
    @Headers('authorization') authorization?: string,
  ): Promise<{ ok: true }> {
    const raw = req.rawBody;
    if (!raw?.length) {
      throw new BadRequestException('empty body');
    }
    await this.livekitWebhook.handleRawPayload(raw, authorization);
    return { ok: true };
  }
}
