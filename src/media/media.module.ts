import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [StorageModule, AuthModule],
  controllers: [MediaController],
})
export class MediaModule {}

