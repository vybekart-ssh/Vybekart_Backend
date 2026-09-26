import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateRazorpayOrderDto {
  @IsUUID()
  addressId!: string;

  /** Optional one-time coupon code applied at checkout. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  couponCode?: string;
}
