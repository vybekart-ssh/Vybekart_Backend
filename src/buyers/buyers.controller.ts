import {
  Controller,
  Get,
  UseGuards,
  Request,
  Query,
  Patch,
  Param,
  Body,
  Post,
  Delete,
} from '@nestjs/common';
import { BuyersService } from './buyers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateBuyerProfileDto } from './dto/update-buyer-profile.dto';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Controller('buyers')
export class BuyersController {
  constructor(private readonly buyersService: BuyersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req: { user: { id: string } }) {
    return this.buyersService.findOne(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  updateProfile(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateBuyerProfileDto,
  ) {
    return this.buyersService.updateProfile(req.user.id, dto);
  }

  /** Buyer home feed: upcoming live, recently viewed, recommendations. */
  @UseGuards(JwtAuthGuard)
  @Get('feed')
  getFeed(@Request() req: { user: { id: string } }) {
    return this.buyersService.getFeed(req.user.id);
  }

  /** Buyer notifications list with optional category filter. */
  @UseGuards(JwtAuthGuard)
  @Get('notifications')
  getNotifications(
    @Request() req: { user: { id: string } },
    @Query('category') category?: string,
  ) {
    return this.buyersService.getNotifications(req.user.id, category);
  }

  /** Mark a single notification as read. */
  @UseGuards(JwtAuthGuard)
  @Patch('notifications/:id/read')
  markNotificationRead(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.buyersService.markNotificationRead(req.user.id, id);
  }

  /** Mark all notifications as read for the buyer. */
  @UseGuards(JwtAuthGuard)
  @Patch('notifications/read-all')
  markAllNotificationsRead(@Request() req: { user: { id: string } }) {
    return this.buyersService.markAllNotificationsRead(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('referrals')
  getReferrals(@Request() req: { user: { id: string } }) {
    return this.buyersService.getReferrals(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('referrals/apply')
  applyReferral(
    @Request() req: { user: { id: string } },
    @Body('code') code: string,
  ) {
    return this.buyersService.applyReferral(req.user.id, code);
  }

  @UseGuards(JwtAuthGuard)
  @Get('help-support')
  getHelpSupport(@Request() req: { user: { id: string } }) {
    return this.buyersService.getHelpSupport(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('addresses')
  listAddresses(@Request() req: { user: { id: string } }) {
    return this.buyersService.listAddresses(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('addresses')
  createAddress(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateAddressDto,
  ) {
    return this.buyersService.createAddress(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('addresses/:id')
  updateAddress(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.buyersService.updateAddress(req.user.id, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('addresses/:id')
  deleteAddress(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.buyersService.deleteAddress(req.user.id, id);
  }
}
