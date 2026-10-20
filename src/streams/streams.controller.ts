import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { StreamsService } from './streams.service';
import { CreateStreamDto } from './dto/create-stream.dto';
import { ScheduleStreamDto } from './dto/schedule-stream.dto';
import { UpdateStreamDto } from './dto/update-stream.dto';
import { JoinTokenDto } from './dto/join-token.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SellerVerifiedGuard } from '../auth/seller-verified.guard';
import { Role } from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { SkipThrottle } from '@nestjs/throttler';
import { StreamDeviceRecordingService } from './stream-device-recording.service';
import {
  DeviceRecordingCompleteDto,
  DeviceRecordingStatusDto,
  DeviceRecordingUploadSessionDto,
} from './dto/device-recording.dto';
import { RecordStreamViewDto } from './dto/record-stream-view.dto';

function isPrefetchFlag(value?: string): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true';
}

@Controller('streams')
export class StreamsController {
  constructor(
    private readonly streamsService: StreamsService,
    private readonly deviceRecording: StreamDeviceRecordingService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  create(
    @Request() req: { user: { id: string } },
    @Body() createStreamDto: CreateStreamDto,
  ) {
    return this.streamsService.create(createStreamDto, req.user.id);
  }

  @Post('schedule')
  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  schedule(
    @Request() req: { user: { id: string } },
    @Body() dto: ScheduleStreamDto,
  ) {
    return this.streamsService.scheduleStream(dto, req.user.id);
  }

  @Post(':id/start-scheduled')
  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  startScheduled(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.streamsService.startScheduledStream(id, req.user.id);
  }

  @Get('active')
  @SkipThrottle()
  findAllActive(
    @Query() query: PaginationQueryDto,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.streamsService.findAllActive(query, categoryId);
  }

  @Get('me/active-live')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  findMyActiveLive(@Request() req: { user: { id: string } }) {
    return this.streamsService.findSellerActiveLive(req.user.id);
  }

  /**
   * Get a viewer token (no auth). Same as GET :id/viewer-token but path is unambiguous.
   * Use: GET /streams/viewer-token/:id or GET /streams/viewer-token?streamId=xxx
   */
  @Get('viewer-token/:id')
  getViewerTokenById(
    @Param('id') id: string,
    @Query('identity') identity?: string,
    @Query('prefetch') prefetch?: string,
  ) {
    return this.streamsService.getViewerToken(id, identity || 'viewer-1', {
      countView: !isPrefetchFlag(prefetch),
    });
  }

  /**
   * Get a viewer token (no auth). For local testing: open /viewer?streamId=xxx
   * Must be before @Get(':id') so /streams/:id/viewer-token is matched correctly.
   */
  @Get(':id/viewer-token')
  getViewerToken(
    @Param('id') id: string,
    @Query('identity') identity?: string,
    @Query('prefetch') prefetch?: string,
  ) {
    return this.streamsService.getViewerToken(id, identity || 'viewer-1', {
      countView: !isPrefetchFlag(prefetch),
    });
  }

  /**
   * Counts one view when a preloaded (prefetch) live/replay actually becomes visible
   * to the buyer (reels feed). Deduped with the same keys as viewer-token / archive.
   */
  @Post(':id/views')
  @UseGuards(JwtAuthGuard)
  recordView(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
    @Body() dto: RecordStreamViewDto,
  ) {
    return this.streamsService.recordView(id, req.user.id, dto.identity);
  }

  @Get(':id/live-state')
  @SkipThrottle()
  getLiveState(@Param('id') id: string) {
    return this.streamsService.getLiveState(id);
  }

  /** Public share card for WhatsApp / OG previews (no auth). */
  @Get(':id/share-preview')
  @SkipThrottle()
  getSharePreview(@Param('id') id: string) {
    return this.streamsService.getSharePreview(id);
  }

  @Get(':id/archive')
  @UseGuards(JwtAuthGuard)
  getArchive(
    @Param('id') id: string,
    @Request() req: { user: { id: string; role?: Role } },
    @Query('prefetch') prefetch?: string,
  ) {
    return this.streamsService.getArchivePlayback(id, req.user.id, {
      isSeller: req.user.role === Role.SELLER,
      countView: !isPrefetchFlag(prefetch),
    });
  }

  @Get(':id')
  @SkipThrottle()
  findOne(@Param('id') id: string) {
    return this.streamsService.findOne(id);
  }

  @Get(':id/store')
  getStoreProducts(
    @Param('id') id: string,
    @Query('search') search?: string,
    @Query('sort') sort?: 'best_seller' | 'auction' | 'sold',
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
  ) {
    return this.streamsService.getStoreProducts(id, {
      search,
      sort,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
    });
  }

  @Get(':id/comments')
  getComments(@Param('id') id: string) {
    return this.streamsService.getComments(id);
  }

  @Post(':id/comments')
  @UseGuards(JwtAuthGuard)
  addComment(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body('text') text: string,
  ) {
    if (!text || !text.trim()) throw new BadRequestException('Comment text is required');
    return this.streamsService.addComment(id, req.user.id, text);
  }

  @Get(':id/like')
  @UseGuards(JwtAuthGuard)
  getLikeStatus(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.streamsService.getLikeStatus(id, req.user.id);
  }

  /** Body `{ liked: boolean }` sets the like; an empty body toggles (older app builds). */
  @Post(':id/like')
  @UseGuards(JwtAuthGuard)
  toggleLike(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body('liked') liked?: unknown,
  ) {
    return this.streamsService.toggleLike(
      id,
      req.user.id,
      typeof liked === 'boolean' ? liked : undefined,
    );
  }

  @Post(':id/follow')
  @UseGuards(JwtAuthGuard)
  followSeller(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.streamsService.followSeller(id, req.user.id);
  }

  @Get(':id/follow-status')
  @UseGuards(JwtAuthGuard)
  getFollowStatus(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.streamsService.getFollowStatus(id, req.user.id);
  }

  @Post(':id/bid')
  @UseGuards(JwtAuthGuard)
  addBid(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body('amount') amount: number,
  ) {
    return this.streamsService.addBid(id, req.user.id, Number(amount));
  }

  @Post(':id/token')
  @UseGuards(JwtAuthGuard)
  getJoinToken(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: JoinTokenDto,
  ) {
    return this.streamsService.getJoinToken(id, req.user.id, dto.identity);
  }

  @Patch(':id/seller-heartbeat')
  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  sellerHeartbeat(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.streamsService.touchSellerHeartbeat(id, req.user.id);
  }

  /** Seller calls after camera track is publishing — notifies buyers and marks stream visible. */
  @Patch(':id/publish-ready')
  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  publishReady(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.streamsService.markBroadcastStarted(id, req.user.id);
  }

  /** Seller phone HD recording: returns a signed Supabase TUS target for the MP4. */
  @Post(':id/device-recording/upload-session')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  deviceRecordingUploadSession(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: DeviceRecordingUploadSessionDto,
  ) {
    return this.deviceRecording.createUploadSession(id, req.user.id, dto);
  }

  @Post(':id/device-recording/complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  deviceRecordingComplete(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: DeviceRecordingCompleteDto,
  ) {
    return this.deviceRecording.completeUpload(id, req.user.id, dto);
  }

  @Post(':id/device-recording/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  deviceRecordingStatus(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: DeviceRecordingStatusDto,
  ) {
    return this.deviceRecording.reportStatus(id, req.user.id, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  update(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() updateStreamDto: UpdateStreamDto,
  ) {
    return this.streamsService.update(id, updateStreamDto, req.user.id);
  }

  @Patch(':id/stop')
  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  stopStream(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.streamsService.stopStream(id, req.user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  remove(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.streamsService.remove(id, req.user.id);
  }
}
