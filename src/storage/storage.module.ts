import { Module } from '@nestjs/common';
import { SupabaseStorageService } from './supabase-storage.service';
import { StorageCleanupService } from './storage-cleanup.service';
import { PackingVideoStorageService } from './packing-video-storage.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SupabaseStorageService, StorageCleanupService, PackingVideoStorageService],
  exports: [SupabaseStorageService, PackingVideoStorageService],
})
export class StorageModule {}

