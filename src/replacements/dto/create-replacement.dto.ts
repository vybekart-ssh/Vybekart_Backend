import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateReplacementDto {
  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUUID()
  orderItemId!: string;

  @IsOptional()
  @IsString()
  replacementVariantId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoUrls?: string[];
}
