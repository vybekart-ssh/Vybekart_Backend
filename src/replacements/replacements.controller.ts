import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BuyerAccessGuard } from '../auth/buyer-access.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role, ReplacementStatus } from '@prisma/client';
import { ReplacementsService } from './replacements.service';
import { CreateReplacementDto } from './dto/create-replacement.dto';
import { DecideReplacementDto } from './dto/decide-replacement.dto';
import { SellerVerifiedGuard } from '../auth/seller-verified.guard';

@Controller()
@UseGuards(JwtAuthGuard)
export class ReplacementsController {
  constructor(private readonly replacements: ReplacementsService) {}

  @Post('orders/:orderId/replacement')
  @UseGuards(BuyerAccessGuard)
  create(
    @Request() req: { user: { id: string } },
    @Param('orderId') orderId: string,
    @Body() dto: CreateReplacementDto,
  ) {
    return this.replacements.createForOrder(req.user.id, orderId, dto);
  }

  @Get('buyers/replacements/eligible')
  @UseGuards(BuyerAccessGuard)
  listEligible(@Request() req: { user: { id: string } }) {
    return this.replacements.listEligibleForBuyer(req.user.id);
  }

  @Get('buyers/replacements')
  @UseGuards(BuyerAccessGuard)
  listMine(@Request() req: { user: { id: string } }) {
    return this.replacements.listForBuyer(req.user.id);
  }

  @Get('orders/:orderId/replacement')
  getForOrder(
    @Request() req: { user: { id: string; roles: Role[] } },
    @Param('orderId') orderId: string,
  ) {
    return this.replacements.getForOrder(
      req.user.id,
      orderId,
      req.user.roles ?? [],
    );
  }

  @Get('replacements/seller')
  @UseGuards(RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  listSeller(
    @Request() req: { user: { id: string } },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.replacements.listForSeller(
      req.user.id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Patch('replacements/:id/ship')
  @UseGuards(RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  ship(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.replacements.ship(id, req.user.id);
  }

  @Patch('replacements/:id/deliver')
  @UseGuards(RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  deliver(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.replacements.deliver(id, req.user.id);
  }

  @Get('admin/replacements')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  listAdmin(
    @Query('status') status?: ReplacementStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.replacements.listAdmin(
      status,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('admin/replacements/:id')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  detail(@Param('id') id: string) {
    return this.replacements.getAdminDetail(id);
  }

  @Patch('admin/replacements/:id/decide')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  decide(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: DecideReplacementDto,
  ) {
    return this.replacements.decide(id, req.user.id, dto);
  }
}
