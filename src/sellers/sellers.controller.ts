import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { SellersService } from './sellers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { UpdateSellerProfileDto } from './dto/update-seller-profile.dto';
import { UpdateBankDetailsDto } from './dto/bank-details.dto';
import { UpdateStoreDetailsDto } from './dto/store-details.dto';
import { UpdateSignatureDto } from './dto/signature.dto';

@Controller('sellers')
export class SellersController {
  constructor(private readonly sellersService: SellersService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Get('profile')
  getProfile(@Request() req: { user: { id: string } }) {
    return this.sellersService.findOne(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Get('dashboard')
  getDashboard(@Request() req: { user: { id: string } }) {
    return this.sellersService.getMyDashboardStats(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Get('revenue/today')
  getRevenueToday(@Request() req: { user: { id: string } }) {
    return this.sellersService.getRevenueToday(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Get('bank-details')
  getBankDetails(@Request() req: { user: { id: string } }) {
    return this.sellersService.getBankDetails(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Patch('bank-details')
  updateBankDetails(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateBankDetailsDto,
  ) {
    return this.sellersService.updateBankDetails(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Get('store-details')
  getStoreDetails(@Request() req: { user: { id: string } }) {
    return this.sellersService.getStoreDetails(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Patch('store-details')
  updateStoreDetails(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateStoreDetailsDto,
  ) {
    return this.sellersService.updateStoreDetails(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Get('signature')
  getSignature(@Request() req: { user: { id: string } }) {
    return this.sellersService.getSignature(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Patch('signature')
  updateSignature(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateSignatureDto,
  ) {
    return this.sellersService.updateSignature(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Patch('profile')
  updateProfile(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateSellerProfileDto,
  ) {
    return this.sellersService.updateProfile(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('pending')
  findPending() {
    return this.sellersService.findPending();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':id/approve')
  approve(@Param('id') id: string) {
    return this.sellersService.approve(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.sellersService.reject(id, reason ?? '');
  }
}
