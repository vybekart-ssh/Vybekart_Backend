import {
<<<<<<< HEAD
  Body,
  Controller,
  Get,
  Patch,
  Query,
  Request,
  UseGuards,
=======
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  BadRequestException,
>>>>>>> d6a25c0f08f1171e7dc99d62e6c10bf7d4e6bc48
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
<<<<<<< HEAD
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

=======
import { Role, VerificationStatus } from '@prisma/client';
import { AdminService } from './admin.service';
import { UpdateAppConfigDto } from './dto/update-app-config.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('me')
  getMe(@Request() req: { user: { id: string } }) {
    return this.adminService.getMe(req.user.id);
  }

  @Get('sellers')
  listSellers(@Query('status') statusRaw?: string) {
    let status: VerificationStatus | undefined;
    if (statusRaw?.trim()) {
      const v = statusRaw.trim().toUpperCase();
      if (
        !Object.values(VerificationStatus).includes(v as VerificationStatus)
      ) {
        throw new BadRequestException('Invalid status filter');
      }
      status = v as VerificationStatus;
    }
    return this.adminService.listSellers(status);
  }

  @Get('sellers/:id')
  getSeller(@Param('id') id: string) {
    return this.adminService.getSellerDetail(id);
  }

  @Patch('sellers/:id/approve')
  approve(@Param('id') id: string) {
    return this.adminService.approveSeller(id);
  }

  @Patch('sellers/:id/reject')
  reject(
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.adminService.rejectSeller(id, reason);
  }

  @Patch('sellers/:id/reregister')
  reregister(@Param('id') id: string) {
    return this.adminService.reregisterSeller(id);
  }

  @Get('app-config')
  getAppConfig() {
    return this.adminService.getAppConfig();
  }

  @Patch('app-config')
  patchAppConfig(@Body() dto: UpdateAppConfigDto) {
    return this.adminService.patchAppConfig(dto);
  }
}
>>>>>>> d6a25c0f08f1171e7dc99d62e6c10bf7d4e6bc48
