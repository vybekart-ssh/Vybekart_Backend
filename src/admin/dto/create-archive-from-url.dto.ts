import { BadRequestException } from '@nestjs/common';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export function assertDirectReplayUrl(raw: string): string {
  const url = (raw ?? '').trim();
  if (!url) {
    throw new BadRequestException('replayUrl is required');
  }
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    throw new BadRequestException('replayUrl must be a valid http(s) URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('replayUrl must use http or https');
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtu.be' ||
    host === 'music.youtube.com'
  ) {
    throw new BadRequestException(
      'YouTube links cannot be used for archive replay. Paste a direct MP4 or HLS (.m3u8) URL from your CDN/storage.',
    );
  }
  return parsed.toString();
}

export class CreateArchiveFromUrlDto {
  @IsString()
  sellerId!: string;

  @IsString()
  @IsUrl({ require_protocol: true }, { message: 'replayUrl must be a valid URL' })
  @MaxLength(2000)
  replayUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  /** Hours to keep public, or -1 for Forever (same as upload archives). */
  @Min(-1)
  retentionHours?: number;

  @IsOptional()
  @IsString()
  startedAt?: string;

  @IsOptional()
  @IsString()
  endedAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationSec?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  thumbnailUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];
}
