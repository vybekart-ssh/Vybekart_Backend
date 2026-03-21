import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsDateString,
  ArrayMin,
  ArrayMax,
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

  /** Exactly 1–3 seller-owned products; thumbnail is derived from the first product’s image. */
  @IsArray()
  @ArrayMin(1)
  @ArrayMax(3)
  @IsString({ each: true })
  productIds: string[];
}
