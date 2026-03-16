import { IsString, IsOptional } from 'class-validator';

export class CheckoutOrderDto {
  @IsString()
  shippingAddress: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;
}

