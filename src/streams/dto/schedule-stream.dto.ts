import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsDateString,
  ArrayMinSize,
  ArrayMaxSize,
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

  /** Exactly 1–3 seller-owned products; thumbnail defaults to the first product image unless `thumbnailUrl` is set. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  productIds: string[];

  @IsString()
  @IsOptional()
  thumbnailUrl?: string;
}
