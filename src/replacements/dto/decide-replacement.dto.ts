import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class DecideReplacementDto {
  @IsBoolean()
  approved: boolean;

  @IsOptional()
  @IsString()
  adminNote?: string;
}
