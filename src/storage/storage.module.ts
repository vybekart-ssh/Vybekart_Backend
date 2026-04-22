import { Module } from '@nestjs/common';
import { SupabaseStorageService } from './supabase-storage.service';
import { StorageCleanupService } from './storage-cleanup.service';

@Module({
  providers: [SupabaseStorageService, StorageCleanupService],
  exports: [SupabaseStorageService],
})
export class StorageModule {}

