import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RecordStreamViewDto {
  /** Same LiveKit identity the viewer used for `viewer-token` (keeps live dedupe aligned). */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  identity?: string;
}
