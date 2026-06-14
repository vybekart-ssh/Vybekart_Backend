import { Body, Controller, Param, Post, Request, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BuyerAccessGuard } from '../auth/buyer-access.guard';
import { CreateRazorpayOrderDto } from './dto/create-razorpay-order.dto';
import { VerifyRazorpayPaymentDto } from './dto/verify-razorpay-payment.dto';
import { ReplacementBalancePaymentDto } from './dto/replacement-balance-payment.dto';

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

  @Post('replacement-balance/:replacementId/create-order')
  @UseGuards(JwtAuthGuard, BuyerAccessGuard)
  createReplacementBalanceOrder(
    @Request() req: { user: { id: string } },
    @Param('replacementId') replacementId: string,
  ) {
    return this.payments.createReplacementBalanceOrder(
      req.user.id,
      replacementId,
    );
  }

  @Post('replacement-balance/verify')
  @UseGuards(JwtAuthGuard, BuyerAccessGuard)
  verifyReplacementBalance(
    @Request() req: { user: { id: string } },
    @Body() dto: ReplacementBalancePaymentDto,
  ) {
    return this.payments.verifyReplacementBalancePayment(req.user.id, dto);
  }
}
