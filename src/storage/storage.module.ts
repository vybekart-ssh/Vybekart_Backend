import { Module } from '@nestjs/common';
import { SupabaseStorageService } from './supabase-storage.service';
import { PackingVideoStorageService } from './packing-video-storage.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SupabaseStorageService, PackingVideoStorageService],
  exports: [SupabaseStorageService, PackingVideoStorageService],
})
export class StorageModule {}

