import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';

/** Either email or phone required for forgot password (OTP sent to that identifier). */
export class ForgotPasswordDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

/** Reset password with OTP: provide either email or phone (must match forgot-password). */
export class ResetPasswordDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;
}
