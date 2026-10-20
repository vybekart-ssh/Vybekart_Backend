import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ADMIN_BROADCAST_AUDIENCES } from '../../notifications/admin-broadcast.service';

export class SendAdminNotificationDto {
  @IsString()
  @IsIn(ADMIN_BROADCAST_AUDIENCES)
  audience: string;

  /** Required when audience is SELECTED. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  userIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string;

  /** Random id per Send tap; the same id is only ever delivered once. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientRequestId?: string;
}
