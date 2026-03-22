import { IsUUID, IsInt, Min, IsOptional, IsString } from 'class-validator';

export class CartItemDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsString()
  color?: string;

  /** Live stream the buyer is shopping from (required when cart is empty). */
  @IsOptional()
  @IsUUID()
  streamId?: string;
}

export class UpdateCartQuantityDto {
  @IsInt()
  @Min(1)
  quantity: number;
}

