import { IsString } from 'class-validator';

/** Address/cart context is read from the server payment session (Redis), not the client. */
export class VerifyRazorpayPaymentDto {
  @IsString()
  razorpayOrderId!: string;

  @IsString()
  razorpayPaymentId!: string;

  @IsString()
  razorpaySignature!: string;
}
