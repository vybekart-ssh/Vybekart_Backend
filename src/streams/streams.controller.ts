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

@Controller('streams')
export class StreamsController {
  constructor(private readonly streamsService: StreamsService) {}

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
  getViewerTokenById(@Param('id') id: string, @Query('identity') identity?: string) {
    return this.streamsService.getViewerToken(id, identity || 'viewer-1');
  }

  /**
   * Get a viewer token (no auth). For local testing: open /viewer?streamId=xxx
   * Must be before @Get(':id') so /streams/:id/viewer-token is matched correctly.
   */
  @Get(':id/viewer-token')
  getViewerToken(
    @Param('id') id: string,
    @Query('identity') identity?: string,
  ) {
    return this.streamsService.getViewerToken(id, identity || 'viewer-1');
  }

  @Get(':id/live-state')
  @SkipThrottle()
  getLiveState(@Param('id') id: string) {
    return this.streamsService.getLiveState(id);
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

  @Post(':id/like')
  @UseGuards(JwtAuthGuard)
  toggleLike(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.streamsService.toggleLike(id, req.user.id);
  }

  @Post(':id/follow')
  @UseGuards(JwtAuthGuard)
  followSeller(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.streamsService.followSeller(id, req.user.id);
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
