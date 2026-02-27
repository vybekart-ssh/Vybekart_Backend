import { IsString, IsOptional, MaxLength, MinLength } from 'class-validator';

export class ReportIssueDto {
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
  @MaxLength(100)
  category?: string;
}
