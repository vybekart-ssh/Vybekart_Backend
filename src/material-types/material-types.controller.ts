import { Controller, Get } from '@nestjs/common';
import { MaterialTypesService } from './material-types.service';

@Controller('material-types')
export class MaterialTypesController {
  constructor(private readonly materialTypesService: MaterialTypesService) {}

  @Get()
  findAll() {
    return this.materialTypesService.findAll();
  }
}
