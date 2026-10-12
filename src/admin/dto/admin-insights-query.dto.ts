import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { SellerInsightsQueryDto } from '../../sellers/dto/seller-insights-query.dto';

export const ADMIN_REPORT_TYPES = ['overview', 'sellers', 'orders', 'seller'] as const;
export type AdminReportType = (typeof ADMIN_REPORT_TYPES)[number];

export const ADMIN_REPORT_STATUSES = ['PAID', 'PACKED', 'SHIPPED', 'DELIVERED'] as const;
export type AdminReportStatus = (typeof ADMIN_REPORT_STATUSES)[number];

/** period / from / to as for sellers, plus an optional seller filter. */
export class AdminInsightsQueryDto extends SellerInsightsQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'sellerId must be a valid seller id' })
  sellerId?: string;
}

export class AdminReportQueryDto extends AdminInsightsQueryDto {
  /** overview (platform) · sellers (payouts / settlement) · orders (register) · seller (one seller's payout report). */
  @IsOptional()
  @IsIn(ADMIN_REPORT_TYPES as unknown as string[])
  type?: AdminReportType;

  /** Orders report only: limit to one order status. */
  @IsOptional()
  @IsIn(ADMIN_REPORT_STATUSES as unknown as string[])
  status?: AdminReportStatus;
}
