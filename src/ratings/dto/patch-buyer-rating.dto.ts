import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class PatchBuyerRatingDto {
  @IsNumber()
  @Min(0)
  @Max(5)
  score: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
