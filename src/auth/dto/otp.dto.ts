import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/** E.164 or local digits; adjust pattern as needed */
const PHONE_REGEX = /^\+?[1-9]\d{1,14}$/;

export class SendOtpDto {
  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  email?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(PHONE_REGEX, {
    message: 'Phone must be in E.164 format (e.g. +919876543210)',
  })
  phone?: string;
}

export class VerifyOtpDto {
  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  email?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(PHONE_REGEX, { message: 'Phone must be in E.164 format' })
  phone?: string;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(6, { message: 'OTP must be 6 digits' })
  @MaxLength(6, { message: 'OTP must be 6 digits' })
  @Matches(/^\d{6}$/, { message: 'OTP must be 6 digits' })
  code: string;
}
