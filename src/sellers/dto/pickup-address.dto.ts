import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class UpdatePickupAddressDto {
  @IsString()
  @MaxLength(350)
  line1: string;

  @IsOptional()
  @IsString()
  @MaxLength(350)
  line2?: string;

  @IsString()
  @MaxLength(120)
  city: string;

  @IsString()
  @MaxLength(120)
  state: string;

  @IsString()
  @MaxLength(20)
  @Matches(/^\d{6}$/, { message: 'PIN code must be exactly 6 digits' })
  zip: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;
}
