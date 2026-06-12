import { IsUUID } from 'class-validator';
import { VerifyRazorpayPaymentDto } from './verify-razorpay-payment.dto';

export class ReplacementBalancePaymentDto extends VerifyRazorpayPaymentDto {
  @IsUUID()
  replacementId!: string;
}
