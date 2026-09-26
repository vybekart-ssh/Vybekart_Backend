import { BadRequestException } from '@nestjs/common';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CouponDiscountType, CouponVisibility } from '@prisma/client';

export class CreateCouponDto {
  @IsString()
  @MaxLength(64)
  code!: string;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsEnum(CouponVisibility)
  visibility!: CouponVisibility;

  @IsEnum(CouponDiscountType)
  discountType!: CouponDiscountType;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  discountValue!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;
}

export class UpdateCouponDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsEnum(CouponVisibility)
  visibility?: CouponVisibility;

  @IsOptional()
  @IsEnum(CouponDiscountType)
  discountType?: CouponDiscountType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  discountValue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;
}

export function assertCouponDiscountShape(dto: {
  discountType: CouponDiscountType;
  discountValue: number;
}): void {
  if (
    dto.discountType === CouponDiscountType.PERCENT &&
    dto.discountValue > 100
  ) {
    throw new BadRequestException('Percent discount cannot exceed 100');
  }
}

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}
