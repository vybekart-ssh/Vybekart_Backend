import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BuyerAccessGuard } from '../auth/buyer-access.guard';
import { CreateRazorpayOrderDto } from './dto/create-razorpay-order.dto';
import { VerifyRazorpayPaymentDto } from './dto/verify-razorpay-payment.dto';

@Controller('payments/razorpay')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('create-order')
  @UseGuards(JwtAuthGuard, BuyerAccessGuard)
  createOrder(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateRazorpayOrderDto,
  ) {
    return this.payments.createRazorpayOrder(req.user.id, dto);
  }

  @Post('verify')
  @UseGuards(JwtAuthGuard, BuyerAccessGuard)
  verify(
    @Request() req: { user: { id: string } },
    @Body() dto: VerifyRazorpayPaymentDto,
  ) {
    return this.payments.verifyAndCheckout(req.user.id, dto);
  }
}
