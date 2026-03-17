import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsUUID,
  IsIn,
} from 'class-validator';

export class CreateStreamDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  @IsIn(['PUBLIC', 'FOLLOWERS_ONLY'])
  visibility?: 'PUBLIC' | 'FOLLOWERS_ONLY';

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  productIds?: string[];
}
