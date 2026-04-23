import { Module } from '@nestjs/common';
import { SupabaseStorageService } from './supabase-storage.service';
import { StorageCleanupService } from './storage-cleanup.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SupabaseStorageService, StorageCleanupService],
  exports: [SupabaseStorageService],
})
export class StorageModule {}

