import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role, VerificationStatus } from '@prisma/client';
import { AdminService } from './admin.service';
import { UpdateAppConfigDto } from './dto/update-app-config.dto';
import { RequestSellerChangesDto } from './dto/request-seller-changes.dto';

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

  @Patch('sellers/:id/request-changes')
  requestChanges(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: RequestSellerChangesDto,
  ) {
    return this.adminService.requestSellerChanges({
      sellerId: id,
      adminUserId: req.user.id,
      dto,
    });
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

  @Get('packing-videos')
  packingVideos(@Query('sellerId') sellerId?: string) {
    return this.adminService.listPackingVideos({ sellerId });
  }

  @Get('archives')
  listArchives(
    @Query('sellerId') sellerId?: string,
    @Query('q') q?: string,
  ) {
    return this.adminService.listArchives({ sellerId, q });
  }

  @Get('archives/retention-options')
  retentionOptions() {
    return this.adminService.retentionOptions();
  }

  @Get('archives/:id')
  getArchive(@Param('id') id: string) {
    return this.adminService.getArchive(id);
  }

  @Post('archives')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'video', maxCount: 1 },
        { name: 'thumbnail', maxCount: 1 },
      ],
      { limits: { fileSize: 512 * 1024 * 1024 } },
    ),
  )
  createArchive(
    @UploadedFiles()
    files: {
      video?: Express.Multer.File[];
      thumbnail?: Express.Multer.File[];
    },
    @Body('sellerId') sellerId?: string,
    @Body('title') title?: string,
    @Body('description') description?: string,
    @Body('retentionHours') retentionHoursRaw?: string,
    @Body('startedAt') startedAt?: string,
    @Body('endedAt') endedAt?: string,
    @Body('durationSec') durationSecRaw?: string,
  ) {
    const video = files?.video?.[0];
    if (!video?.buffer?.length) {
      throw new BadRequestException('video file is required');
    }
    if (!sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    const retentionHours = retentionHoursRaw
      ? parseInt(retentionHoursRaw, 10)
      : undefined;
    const durationSec = durationSecRaw
      ? parseInt(durationSecRaw, 10)
      : undefined;
    const thumb = files?.thumbnail?.[0];
    return this.adminService.createArchiveFromUpload({
      sellerId: sellerId.trim(),
      title,
      description,
      retentionHours,
      startedAt,
      endedAt,
      durationSec,
      video: {
        buffer: video.buffer,
        mimetype: video.mimetype,
        originalname: video.originalname,
      },
      thumbnail: thumb
        ? { buffer: thumb.buffer, mimetype: thumb.mimetype }
        : null,
    });
  }

  @Patch('archives/:id')
  updateArchive(
    @Param('id') id: string,
    @Body()
    body: {
      sellerId?: string;
      title?: string;
      description?: string;
      retentionHours?: number;
      startedAt?: string;
      endedAt?: string;
      durationSec?: number | null;
      thumbnailUrl?: string | null;
    },
  ) {
    return this.adminService.updateArchive(id, body ?? {});
  }

  @Delete('archives/:id')
  deleteArchive(@Param('id') id: string) {
    return this.adminService.deleteArchive(id);
  }

  @Get('users/buyers')
  listBuyers(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listBuyers(
      q,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('users/buyers/:id')
  getBuyerDetail(@Param('id') id: string) {
    return this.adminService.getBuyerDetail(id);
  }

  @Get('users/sellers')
  listSellerDirectory(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listSellerDirectory(
      q,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('users/sellers/:id')
  getSellerUserDetail(@Param('id') id: string) {
    return this.adminService.getSellerUserDetail(id);
  }
}
