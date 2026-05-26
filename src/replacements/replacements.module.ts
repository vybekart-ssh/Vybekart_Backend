import { Module } from '@nestjs/common';
import { ReplacementsService } from './replacements.service';
import { ReplacementsController } from './replacements.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RatingsModule } from '../ratings/ratings.module';

@Module({
  imports: [PrismaModule, RatingsModule],
  controllers: [ReplacementsController],
  providers: [ReplacementsService],
  exports: [ReplacementsService],
})
export class ReplacementsModule {}
