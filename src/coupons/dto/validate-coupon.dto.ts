import { IsString, IsUUID, MaxLength } from 'class-validator';

export class ValidateCouponDto {
  @IsString()
  @MaxLength(64)
  code!: string;

  @IsUUID()
  addressId!: string;
}
