import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import {
  BIRTH_DATE_FORMAT_MESSAGE,
  BIRTH_DATE_PATTERN,
} from '../../common/utils/birth-date.util';

export class UpdateBuyerProfileDto {
  /** `YYYY-MM-DD`. */
  @IsOptional()
  @IsString()
  @Matches(BIRTH_DATE_PATTERN, { message: BIRTH_DATE_FORMAT_MESSAGE })
  birthDate?: string;

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
