import { IsIn, IsOptional, Matches } from 'class-validator';

export class SellerInsightsQueryDto {
  /** daily (today) · weekly (last 7 days) · monthly (this month) · custom (from/to). Default daily. */
  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly', 'custom'])
  period?: 'daily' | 'weekly' | 'monthly' | 'custom';

  /** Custom range start, inclusive IST date. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  /** Custom range end, inclusive IST date. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}
