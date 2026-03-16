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
}

export class UpdateCartQuantityDto {
  @IsInt()
  @Min(1)
  quantity: number;
}

