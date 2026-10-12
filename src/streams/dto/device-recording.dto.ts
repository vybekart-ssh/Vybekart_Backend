import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class DeviceRecordingUploadSessionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationSec?: number;
}

export class DeviceRecordingCompleteDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationSec?: number;
}

export const DEVICE_RECORDING_CLIENT_STATUSES = [
  'RECORDING',
  'PENDING_UPLOAD',
  'FAILED',
] as const;

export class DeviceRecordingStatusDto {
  @IsIn(DEVICE_RECORDING_CLIENT_STATUSES as unknown as string[])
  status: (typeof DEVICE_RECORDING_CLIENT_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string;
}
