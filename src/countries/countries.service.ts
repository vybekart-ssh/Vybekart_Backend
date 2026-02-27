import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CountriesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.country.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true },
    });
  }

  async findStatesByCountry(countryId: string) {
    if (!countryId?.trim()) {
      throw new BadRequestException('countryId is required');
    }
    return this.prisma.state.findMany({
      where: { countryId },
      orderBy: { name: 'asc' },
      select: { id: true, countryId: true, code: true, name: true },
    });
  }
}
