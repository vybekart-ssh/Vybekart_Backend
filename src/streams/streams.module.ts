import { Module } from '@nestjs/common';
import { StreamsController } from './streams.controller';
import { StreamsService } from './streams.service';
import { StreamsGateway } from './streams.gateway';

@Module({
  controllers: [StreamsController],
  providers: [StreamsService, StreamsGateway],
})
export class StreamsModule {}
