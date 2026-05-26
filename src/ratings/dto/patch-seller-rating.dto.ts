import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class PatchSellerRatingDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  overall?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  quality?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  originality?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  valueForMoney?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
