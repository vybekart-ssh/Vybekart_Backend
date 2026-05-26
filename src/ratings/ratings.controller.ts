import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BuyerAccessGuard } from '../auth/buyer-access.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { RatingsService } from './ratings.service';
import { SubmitSellerRatingDto } from './dto/submit-seller-rating.dto';
import { PatchBuyerRatingDto } from './dto/patch-buyer-rating.dto';
import { PatchSellerRatingDto } from './dto/patch-seller-rating.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Post('ratings/seller')
  @UseGuards(BuyerAccessGuard)
  submitSellerRating(
    @Request() req: { user: { id: string } },
    @Body() dto: SubmitSellerRatingDto,
  ) {
    return this.ratings.submitSellerRating(req.user.id, dto);
  }

  @Get('ratings/seller/:sellerId/public')
  getSellerPublic(@Param('sellerId') sellerId: string) {
    return this.ratings.getSellerPublic(sellerId);
  }

  @Patch('admin/users/buyers/:buyerId/rating')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  adminPatchBuyer(
    @Request() req: { user: { id: string } },
    @Param('buyerId') buyerId: string,
    @Body() dto: PatchBuyerRatingDto,
  ) {
    return this.ratings.adminPatchBuyerRating(buyerId, req.user.id, dto);
  }

  @Patch('admin/users/sellers/:sellerId/rating')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  adminPatchSeller(
    @Request() req: { user: { id: string } },
    @Param('sellerId') sellerId: string,
    @Body() dto: PatchSellerRatingDto,
  ) {
    return this.ratings.adminPatchSellerRating(sellerId, req.user.id, dto);
  }
}
