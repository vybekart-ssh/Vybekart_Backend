import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { DelhiveryService } from './delhivery.service';

@SkipThrottle()
@Controller('admin/delhivery')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminDelhiveryController {
  constructor(private readonly delhivery: DelhiveryService) {}

  /**
   * Safe connectivity check — does not create shipments.
   * Optional ?pin=400001 runs pincode + quote tests.
   */
  @Get('status')
  async status(@Query('pin') pin?: string) {
    return this.delhivery.getIntegrationStatus(pin);
  }
}
