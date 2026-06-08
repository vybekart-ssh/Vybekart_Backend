import { Module, forwardRef } from '@nestjs/common';
import { LivekitWebhookController } from './livekit-webhook.controller';
import { LivekitWebhookService } from './livekit-webhook.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LiveKitModule } from '../livekit/livekit.module';
import { StreamsModule } from '../streams/streams.module';

@Module({
  imports: [PrismaModule, LiveKitModule, forwardRef(() => StreamsModule)],
  controllers: [LivekitWebhookController],
  providers: [LivekitWebhookService],
})
export class WebhooksModule {}
