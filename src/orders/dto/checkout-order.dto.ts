import { IsString, IsOptional, IsUUID } from 'class-validator';

export class CheckoutOrderDto {
  /** Buyer selected shipping address id (preferred, structured). */
  @IsUUID()
  @IsOptional()
  addressId?: string;

  /** Backward compatible: free-text shipping address. */
  @IsString()
  @IsOptional()
  shippingAddress?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;
}

