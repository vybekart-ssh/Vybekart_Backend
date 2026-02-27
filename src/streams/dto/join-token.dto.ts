import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class JoinTokenDto {
  @IsString()
  @IsNotEmpty()
  identity: string;

  @IsString()
  @IsOptional()
  metadata?: string;
}
