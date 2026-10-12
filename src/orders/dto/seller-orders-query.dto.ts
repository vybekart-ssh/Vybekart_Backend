import { IsOptional, IsInt, Min, Max, IsString, Matches } from 'class-validator';
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

  /** `today` or `YYYY-MM-DD` — omit for all dates */
  @IsOptional()
  @IsString()
  @Matches(/^(today|\d{4}-\d{2}-\d{2})$/, {
    message: 'date must be today or YYYY-MM-DD',
  })
  date?: string;

  /** Inclusive IST range start (YYYY-MM-DD); used with `to` when `date` is omitted. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  /** Inclusive IST range end (YYYY-MM-DD). */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}
