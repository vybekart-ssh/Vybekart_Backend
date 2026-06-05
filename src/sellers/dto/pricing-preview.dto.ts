import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class PricingPreviewQueryDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  customerPrice: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  gstPercent?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  logisticsBase?: number;
}
