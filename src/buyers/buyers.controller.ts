import {
  Controller,
  Get,
  UseGuards,
  Request,
  Query,
  Patch,
  Param,
} from '@nestjs/common';
import { BuyersService } from './buyers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('buyers')
export class BuyersController {
  constructor(private readonly buyersService: BuyersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req: { user: { id: string } }) {
    return this.buyersService.findOne(req.user.id);
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
}
