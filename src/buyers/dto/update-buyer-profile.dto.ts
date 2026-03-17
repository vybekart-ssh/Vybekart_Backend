import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateBuyerProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/, {
    message: 'Phone must be a valid number with country code (or 10+ digits)',
  })
  phone?: string;
}

