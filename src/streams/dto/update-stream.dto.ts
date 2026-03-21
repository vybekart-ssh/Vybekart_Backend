import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

/** Explicit optional fields — avoids TS losing inherited props from `PartialType` + class-validator. */
export class UpdateStreamDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsIn(['PUBLIC', 'FOLLOWERS_ONLY'])
  visibility?: 'PUBLIC' | 'FOLLOWERS_ONLY';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsBoolean()
  isLive?: boolean;

  /** Reschedule: sets `startedAt` on the stream */
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
