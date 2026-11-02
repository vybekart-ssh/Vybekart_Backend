import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Flat file names only, e.g. `master.m3u8`, `v480.m3u8`, `v480.mp4`, `v480_init.mp4`, `v480.m4s`. */
export const HLS_FILE_NAME = /^[a-z0-9][a-z0-9_-]{0,40}\.(m3u8|mp4|m4s)$/;
export const HLS_MAX_FILES = 24;

export class HlsFileDto {
  @IsString()
  @Matches(HLS_FILE_NAME, { message: 'Invalid HLS file name' })
  name: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes: number;
}

export class HlsUploadSessionDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(HLS_MAX_FILES)
  @ValidateNested({ each: true })
  @Type(() => HlsFileDto)
  files: HlsFileDto[];
}

export class HlsCompleteDto extends HlsUploadSessionDto {
  /** The master playlist among [files], e.g. `master.m3u8`. */
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{0,40}\.m3u8$/, { message: 'master must be an .m3u8 file' })
  master: string;
}

export const HLS_CLIENT_STATUSES = ['PROCESSING', 'FAILED'] as const;

export class HlsStatusDto {
  @IsIn(HLS_CLIENT_STATUSES as unknown as string[])
  status: (typeof HLS_CLIENT_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string;
}
