import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SellersService } from './sellers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { SellerVerifiedGuard } from '../auth/seller-verified.guard';
import { SkipSellerVerified } from '../auth/skip-seller-verified.decorator';
import { UpdateSellerProfileDto } from './dto/update-seller-profile.dto';
import { UpdateBankDetailsDto } from './dto/bank-details.dto';
import { UpdateStoreDetailsDto } from './dto/store-details.dto';
import { UpdateSignatureDto } from './dto/signature.dto';
import { UpdatePickupAddressDto } from './dto/pickup-address.dto';

@Controller('sellers')
export class SellersController {
  constructor(private readonly sellersService: SellersService) {}

  @SkipSellerVerified()
  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  @Get('profile')
  getProfile(@Request() req: { user: { id: string } }) {
    return this.sellersService.findOne(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  @Get('dashboard')
  getDashboard(@Request() req: { user: { id: string } }) {
    return this.sellersService.getMyDashboardStats(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  @Get('revenue/today')
  getRevenueToday(@Request() req: { user: { id: string } }) {
    return this.sellersService.getRevenueToday(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  @Get('bank-details')
  getBankDetails(@Request() req: { user: { id: string } }) {
    return this.sellersService.getBankDetails(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  @Patch('bank-details')
  @SkipSellerVerified()
  updateBankDetails(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateBankDetailsDto,
  ) {
    return this.sellersService.updateBankDetails(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  @Get('store-details')
  getStoreDetails(@Request() req: { user: { id: string } }) {
    return this.sellersService.getStoreDetails(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  @Patch('store-details')
  @SkipSellerVerified()
  updateStoreDetails(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateStoreDetailsDto,
  ) {
    return this.sellersService.updateStoreDetails(req.user.id, dto);
  }

  @Post('store-media/logo')
  @SkipSellerVerified()
  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  uploadStoreLogo(
    @Request() req: { user: { id: string } },
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.sellersService.uploadStoreLogo(req.user.id, file);
  }

  @Post('store-media/banner')
  @SkipSellerVerified()
  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: 8 * 1024 * 1024 } }),
  )
  uploadStoreBanner(
    @Request() req: { user: { id: string } },
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.sellersService.uploadStoreBanner(req.user.id, file);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  @Get('pickup-address')
  getPickupAddress(@Request() req: { user: { id: string } }) {
    return this.sellersService.getPickupAddress(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Patch('pickup-address')
  updatePickupAddress(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdatePickupAddressDto,
  ) {
    return this.sellersService.updatePickupAddress(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Get('signature')
  getSignature(@Request() req: { user: { id: string } }) {
    return this.sellersService.getSignature(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  @Patch('signature')
  @SkipSellerVerified()
  updateSignature(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateSignatureDto,
  ) {
    return this.sellersService.updateSignature(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  @Patch('profile')
  @SkipSellerVerified()
  updateProfile(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateSellerProfileDto,
  ) {
    return this.sellersService.updateProfile(req.user.id, dto);
  }

  @Post('me/resubmit')
  @SkipSellerVerified()
  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  resubmitForReview(@Request() req: { user: { id: string } }) {
    return this.sellersService.resubmitForReview(req.user.id);
  }
}
