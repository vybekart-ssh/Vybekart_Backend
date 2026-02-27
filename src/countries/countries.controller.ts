import { Controller, Get, Query } from '@nestjs/common';
import { CountriesService } from './countries.service';

@Controller('countries')
export class CountriesController {
  constructor(private readonly countriesService: CountriesService) {}

  @Get()
  findAll() {
    return this.countriesService.findAll();
  }

  @Get('states')
  getStatesByCountry(@Query('countryId') countryId: string) {
    return this.countriesService.findStatesByCountry(countryId);
  }
}
