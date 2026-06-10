import { IsOptional, IsString, Matches } from 'class-validator';

export class SellerOrderCountsQueryDto {
  /** `today` or `YYYY-MM-DD` — omit for all dates */
  @IsOptional()
  @IsString()
  @Matches(/^(today|\d{4}-\d{2}-\d{2})$/, {
    message: 'date must be today or YYYY-MM-DD',
  })
  date?: string;
}
