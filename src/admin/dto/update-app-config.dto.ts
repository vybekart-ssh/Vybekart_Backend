import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ShippingPayer } from '@prisma/client';

export class UpdateAppConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minAndroidVersionCode?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  latestAndroidVersionName?: string | null;

  /** Selling price threshold (INR) for product GST slab split. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  productGstPriceThresholdInr?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  productGstPercentBelow?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  productGstPercentAtOrAbove?: number;

  /** Who pays Delhivery shipping at checkout. */
  @IsOptional()
  @IsEnum(ShippingPayer)
  shippingPayer?: ShippingPayer;
}
