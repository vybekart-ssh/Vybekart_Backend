import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsDateString,
} from 'class-validator';

/** Create a future scheduled stream (no LiveKit until seller goes live). */
export class ScheduleStreamDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDateString()
  scheduledAt: string;

  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  productIds?: string[];
}
