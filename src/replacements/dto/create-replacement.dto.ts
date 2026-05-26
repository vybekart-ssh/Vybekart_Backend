import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateReplacementDto {
  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  orderItemId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoUrls?: string[];
}
