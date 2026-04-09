import { Module } from '@nestjs/common';
import { StreamsController } from './streams.controller';
import { StreamsService } from './streams.service';
import { StreamsGateway } from './streams.gateway';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [StreamsController],
  providers: [StreamsService, StreamsGateway],
})
export class StreamsModule {}
