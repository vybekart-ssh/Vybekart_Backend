import { IsString, IsOptional, IsUrl } from 'class-validator';

export class UpdateSignatureDto {
  @IsOptional()
  @IsUrl()
  signatureUrl?: string;
}
