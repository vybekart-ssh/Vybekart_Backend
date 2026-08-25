import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AppFeedbackDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  message: string;

  /** Experience rating 1–5 stars from the in-app feedback form. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  /** `buyer` (default) or `seller` — controls email copy and user metadata. */
  @IsOptional()
  @IsString()
  @IsIn(['buyer', 'seller'])
  role?: 'buyer' | 'seller';
}
