import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  Matches,
  IsIn,
} from 'class-validator';

/** E.164 or local digits; adjust pattern as needed */
const PHONE_REGEX = /^\+?[1-9]\d{1,14}$/;

export const OTP_PURPOSE_VALUES = [
  'LOGIN',
  'BUYER_SIGNUP',
  'SELLER_SIGNUP',
] as const;
export type OtpPurpose = (typeof OTP_PURPOSE_VALUES)[number];

export class SendOtpDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE_REGEX, {
    message: 'Phone must be in E.164 format (e.g. +919876543210)',
  })
  phone?: string;

  /** Optional purpose to customize SMS copy. Backward compatible. */
  @IsOptional()
  @IsString()
  @IsIn(OTP_PURPOSE_VALUES)
  purpose?: OtpPurpose;
}

export class VerifyOtpDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE_REGEX, { message: 'Phone must be in E.164 format' })
  phone?: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'OTP must be 6 digits' })
  code: string;
}
