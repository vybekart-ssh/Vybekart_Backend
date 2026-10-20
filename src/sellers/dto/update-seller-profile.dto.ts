import {
  IsString,
  IsOptional,
  IsEmail,
  MaxLength,
  Matches,
  MinLength,
} from 'class-validator';

import {
  BIRTH_DATE_FORMAT_MESSAGE,
  BIRTH_DATE_PATTERN,
} from '../../common/utils/birth-date.util';

/** Indian IFSC: 4 letters + 0 + 6 alphanumeric */
const IFSC_REGEX = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;

/**
 * PATCH sellers/profile — personal account fields (User) + optional seller bio.
 * Phone is intentionally not updatable here.
 */
export class UpdateSellerProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  middleName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  email?: string;

  /** `YYYY-MM-DD`. */
  @IsOptional()
  @IsString()
  @Matches(BIRTH_DATE_PATTERN, { message: BIRTH_DATE_FORMAT_MESSAGE })
  birthDate?: string;

  /** Seller "About you" / bio (seller.description). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{9,18}$/, { message: 'Bank account must be 9-18 digits' })
  bankAccount?: string;

  @IsOptional()
  @IsString()
  @Matches(IFSC_REGEX, { message: 'IFSC must be 11 chars (e.g. HDFC0001234)' })
  ifscCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  bannerUrl?: string;
}
