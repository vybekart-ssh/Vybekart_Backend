import { Transform } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsUrl,
  MaxLength,
  Matches,
  ValidateIf,
  IsUUID,
} from 'class-validator';

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
  @Transform(({ value }) => (value === '' ? undefined : value))
  @ValidateIf((o) => o.primaryCategoryId != null && o.primaryCategoryId !== '')
  @IsUUID('4')
  primaryCategoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** App-served URLs; avoid @IsUrl() — validator.js rejects some valid deployment URLs. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  bannerUrl?: string;

  @IsOptional()
  @ValidateIf((o) => o.websiteUrl != null && o.websiteUrl !== '')
  @IsUrl(
    { require_protocol: false, require_tld: false },
    { message: 'Website must be a valid URL' },
  )
  @MaxLength(500)
  websiteUrl?: string;
}
