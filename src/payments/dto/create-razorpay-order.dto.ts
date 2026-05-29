import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateRazorpayOrderDto {
  @IsUUID()
  @IsOptional()
  addressId?: string;

  @IsString()
  @IsOptional()
  shippingAddress?: string;
}
