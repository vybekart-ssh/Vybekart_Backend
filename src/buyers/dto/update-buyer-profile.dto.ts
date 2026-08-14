import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateBuyerProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  middleName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  /** @deprecated Use firstName/middleName/lastName instead. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}
