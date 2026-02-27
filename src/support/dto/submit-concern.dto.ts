import { IsString, IsOptional, MaxLength, MinLength } from 'class-validator';

export class SubmitConcernDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  toEmail: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  toName: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  subject: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  escalationLevel?: string;
}
