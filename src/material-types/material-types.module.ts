import { Module } from '@nestjs/common';
import { MaterialTypesController } from './material-types.controller';
import { MaterialTypesService } from './material-types.service';

@Module({
  controllers: [MaterialTypesController],
  providers: [MaterialTypesService],
  exports: [MaterialTypesService],
})
export class MaterialTypesModule {}
