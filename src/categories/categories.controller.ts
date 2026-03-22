import { Controller, Get, Param } from '@nestjs/common';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  findAll() {
    return this.categoriesService.findAll();
  }

  /** Public metadata for add-product forms (brands, attribute hints). Register before :id. */
  @Get('slug/:slug/metadata')
  getMetadataBySlug(@Param('slug') slug: string) {
    return this.categoriesService.getMetadata(slug);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.categoriesService.findOne(id);
  }
}
