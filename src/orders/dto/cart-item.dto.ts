import { IsUUID, IsInt, Min, IsOptional, IsString, MaxLength } from 'class-validator';

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

  /** Matches Product.variants.items[].id */
  @IsOptional()
  @IsString()
  variantId?: string;

  @IsOptional()
  @IsString()
  variantLabel?: string;

  /** Live stream the buyer is shopping from (required when cart is empty). */
  @IsOptional()
  @IsUUID()
  streamId?: string;

  /** Human-readable stream title for cart/checkout UI (optional). */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  streamTitle?: string;
}

export class UpdateCartQuantityDto {
  @IsInt()
  @Min(1)
  quantity: number;
}

