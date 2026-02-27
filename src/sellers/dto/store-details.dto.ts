import { IsString, IsOptional, IsUrl, MaxLength, Matches, ValidateIf } from 'class-validator';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

export class UpdateStoreDetailsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  businessName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  businessAddress?: string;

  @IsOptional()
  @ValidateIf((o) => o.gstNumber != null && o.gstNumber !== '')
  @IsString()
  @MaxLength(50)
  @Matches(GSTIN_REGEX, { message: 'GST number must be a valid 15-character GSTIN' })
  gstNumber?: string;

  @IsOptional()
  @IsString()
  primaryCategoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @IsOptional()
  @IsUrl()
  bannerUrl?: string;
}
