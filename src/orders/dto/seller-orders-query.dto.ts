import { IsOptional, IsIn, IsInt, Min, Max, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class SellerOrdersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  /** Single status or comma-separated e.g. `PAID,PACKED` */
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsIn(['today'])
  date?: string;
}
