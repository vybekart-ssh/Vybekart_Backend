import { IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class SubmitSellerRatingDto {
  @IsUUID()
  orderId: string;

  @IsNumber()
  @Min(0)
  @Max(5)
  quality: number;

  @IsNumber()
  @Min(0)
  @Max(5)
  originality: number;

  @IsNumber()
  @Min(0)
  @Max(5)
  valueForMoney: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
