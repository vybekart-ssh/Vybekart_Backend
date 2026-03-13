import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  Matches,
} from 'class-validator';

/** E.164 or local digits; adjust pattern as needed */
const PHONE_REGEX = /^\+?[1-9]\d{1,14}$/;

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
