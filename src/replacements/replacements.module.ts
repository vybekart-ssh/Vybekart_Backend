import { Module } from '@nestjs/common';
import { ReplacementsService } from './replacements.service';
import { ReplacementsController } from './replacements.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RatingsModule } from '../ratings/ratings.module';
import { DelhiveryModule } from '../delhivery/delhivery.module';

@Module({
  imports: [PrismaModule, RatingsModule, DelhiveryModule],
  controllers: [ReplacementsController],
  providers: [ReplacementsService],
  exports: [ReplacementsService],
})
export class ReplacementsModule {}
