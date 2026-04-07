import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateAppConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minAndroidVersionCode?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  latestAndroidVersionName?: string | null;
}
