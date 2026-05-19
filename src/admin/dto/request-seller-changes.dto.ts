import { ArrayNotEmpty, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestSellerChangesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  sections: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

