import { Module } from '@nestjs/common';
import { LivekitWebhookController } from './livekit-webhook.controller';
import { LivekitWebhookService } from './livekit-webhook.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LiveKitModule } from '../livekit/livekit.module';

@Module({
  imports: [PrismaModule, LiveKitModule],
  controllers: [LivekitWebhookController],
  providers: [LivekitWebhookService],
})
export class WebhooksModule {}
