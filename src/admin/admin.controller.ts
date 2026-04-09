import {
  Body,
  Controller,
  Get,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('me')
  me(@Request() req: { user: { id: string; email?: string; name?: string } }) {
    return { id: req.user.id, email: req.user.email, name: req.user.name };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('sellers')
  listSellers(@Query('status') status?: string) {
    return this.admin.listSellers(status);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('sellers/:id')
  sellerDetail(@Request() req: any) {
    // Using req.params for compatibility with existing Android JsonObject parsing
    return this.admin.sellerDetail(req.params.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch('sellers/:id/approve')
  approve(@Request() req: any) {
    return this.admin.approveSeller(req.params.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch('sellers/:id/reject')
  reject(@Request() req: any, @Body('reason') reason?: string) {
    return this.admin.rejectSeller(req.params.id, reason ?? '');
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch('sellers/:id/reregister')
  reregister(@Request() req: any) {
    return this.admin.reregisterSeller(req.params.id);
  }

  // Minimal app-config support (Android admin app expects these endpoints).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('app-config')
  getAppConfig() {
    return { minAndroidVersionCode: 1, latestAndroidVersionName: '1.0.0' };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch('app-config')
  patchAppConfig(
    @Body()
    body: { minAndroidVersionCode?: number; latestAndroidVersionName?: string },
  ) {
    // For now: accept and echo back (persisting can be added later).
    return {
      minAndroidVersionCode: body.minAndroidVersionCode ?? 1,
      latestAndroidVersionName: body.latestAndroidVersionName ?? '1.0.0',
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('packing-videos')
  packingVideos(@Query('sellerId') sellerId?: string) {
    return this.admin.listPackingVideos({ sellerId });
  }
}

