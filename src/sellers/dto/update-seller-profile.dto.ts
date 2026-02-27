import {
  IsString,
  IsOptional,
  IsUrl,
  MaxLength,
  Matches,
} from 'class-validator';

/** Indian IFSC: 4 letters + 0 + 6 alphanumeric */
const IFSC_REGEX = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;

export class UpdateSellerProfileDto {
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{9,18}$/, { message: 'Bank account must be 9-18 digits' })
  bankAccount?: string;

  @IsString()
  @IsOptional()
  @Matches(IFSC_REGEX, { message: 'IFSC must be 11 chars (e.g. HDFC0001234)' })
  ifscCode?: string;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @IsOptional()
  @IsUrl()
  bannerUrl?: string;
}
