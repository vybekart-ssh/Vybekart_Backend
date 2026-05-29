import { IsOptional, IsString, IsUUID } from 'class-validator';

export class VerifyRazorpayPaymentDto {
  @IsString()
  razorpayOrderId!: string;

  @IsString()
  razorpayPaymentId!: string;

  @IsString()
  razorpaySignature!: string;

  @IsUUID()
  @IsOptional()
  addressId?: string;

  @IsString()
  @IsOptional()
  shippingAddress?: string;
}
