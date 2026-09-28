import { Module } from '@nestjs/common';
import { ReplacementsService } from './replacements.service';
import { ReplacementsController } from './replacements.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RatingsModule } from '../ratings/ratings.module';
import { DelhiveryModule } from '../delhivery/delhivery.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, RatingsModule, DelhiveryModule, StorageModule],
  controllers: [ReplacementsController],
  providers: [ReplacementsService],
  exports: [ReplacementsService],
})
export class ReplacementsModule {}
