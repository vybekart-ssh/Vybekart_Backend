import {
  IsString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  MinLength,
  IsArray,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}

export class RegisterBuyerDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  phone?: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refresh_token: string;
}

/** Indian IFSC: 4 letters + 0 + 6 alphanumeric */
const IFSC_REGEX = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;
/** Indian pincode: 6 digits, cannot start with 0 */
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

/** Pickup address for seller registration */
export class PickupAddressDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  line1: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  line2?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  state: string;

  @IsString()
  @IsNotEmpty()
  @Matches(PINCODE_REGEX, {
    message: 'Pincode must be 6 digits (Indian format)',
  })
  zip: string;
}

export class RegisterSellerDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'Phone number is required for registration' })
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Phone must be in E.164 format (e.g. +919876543210)',
  })
  phone: string;

  @IsString()
  @IsNotEmpty()
  businessName: string;

  @IsString()
  @IsOptional()
  description?: string;

  /** GSTIN: 15 chars - 2 digit state + 5 letter + 4 digit + 1 letter (PAN) + entity + Z + check digit. Optional; when provided must be valid. */
  @IsOptional()
  @ValidateIf((o) => o.gstNumber != null && o.gstNumber !== '')
  @IsString()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/, {
    message: 'GST number must be a valid 15-character GSTIN (e.g. 29AABCT1332L1ZV)',
  })
  gstNumber?: string;

  /** Product categories the seller operates in (Fashion, Beauty, etc.) */
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  categoryIds?: string[];

  /** Pickup address for order fulfillment */
  @ValidateNested()
  @Type(() => PickupAddressDto)
  @IsOptional()
  pickupAddress?: PickupAddressDto;

  /** Banking details for payouts */
  @IsString()
  @IsOptional()
  @Matches(/^\d{9,18}$/, { message: 'Bank account must be 9-18 digits' })
  bankAccount?: string;

  @IsString()
  @IsOptional()
  @Matches(IFSC_REGEX, { message: 'IFSC must be 11 chars (e.g. HDFC0001234)' })
  ifscCode?: string;
}
