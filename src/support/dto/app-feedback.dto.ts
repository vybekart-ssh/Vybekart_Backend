import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

  /** `buyer` (default) or `seller` — controls email copy and user metadata. */
  @IsOptional()
  @IsString()
  @IsIn(['buyer', 'seller'])
  role?: 'buyer' | 'seller';
}
