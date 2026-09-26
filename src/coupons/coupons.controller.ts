import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BuyerAccessGuard } from '../auth/buyer-access.guard';
import { CouponsService } from './coupons.service';
import { OrdersService } from '../orders/orders.service';
import { ValidateCouponDto } from './dto/validate-coupon.dto';

@Controller('coupons')
export class CouponsController {
  constructor(
    private readonly coupons: CouponsService,
    private readonly orders: OrdersService,
  ) {}

  /** Active, unredeemed PUBLIC coupons within their date window. */
  @Get('public')
  @UseGuards(JwtAuthGuard, BuyerAccessGuard)
  listPublic() {
    return this.coupons.listPublicActive();
  }

  /** Validate a code against current cart + delivery totals for checkout. */
  @Post('validate')
  @UseGuards(JwtAuthGuard, BuyerAccessGuard)
  async validate(
    @Request() req: { user: { id: string } },
    @Body() dto: ValidateCouponDto,
  ) {
    const prep = await this.orders.prepareCheckoutForPayment(
      req.user.id,
      dto.addressId,
    );
    const eligibleBase = prep.subtotal + prep.buyerDeliveryFee;
    return this.coupons.validateAgainstEligibleBase(dto.code, eligibleBase);
  }
}
