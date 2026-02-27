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
} from '@nestjs/common';
import { StreamsService } from './streams.service';
import { CreateStreamDto } from './dto/create-stream.dto';
import { UpdateStreamDto } from './dto/update-stream.dto';
import { JoinTokenDto } from './dto/join-token.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Controller('streams')
export class StreamsController {
  constructor(private readonly streamsService: StreamsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  create(
    @Request() req: { user: { id: string } },
    @Body() createStreamDto: CreateStreamDto,
  ) {
    return this.streamsService.create(createStreamDto, req.user.id);
  }

  @Get('active')
  findAllActive(@Query() query: PaginationQueryDto) {
    return this.streamsService.findAllActive(query);
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

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.streamsService.findOne(id);
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

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  update(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() updateStreamDto: UpdateStreamDto,
  ) {
    return this.streamsService.update(id, updateStreamDto, req.user.id);
  }

  @Patch(':id/stop')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  stopStream(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.streamsService.stopStream(id, req.user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  remove(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.streamsService.remove(id, req.user.id);
  }
}
