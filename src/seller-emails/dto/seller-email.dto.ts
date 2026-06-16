import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SellerEmailKind } from '../seller-email.types';

export class SellerEmailRecipientDto {
  @IsString()
  email!: string;

  @IsString()
  storeName!: string;

  @IsString()
  contactName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  city?: string;
}

export class ParseSellerEmailCsvDto {
  @IsString()
  csvContent!: string;
}

export class PreviewSellerEmailDto {
  @IsEnum(['email1', 'email2'])
  kind!: SellerEmailKind;

  @ValidateNested()
  @Type(() => SellerEmailRecipientDto)
  recipient!: SellerEmailRecipientDto;
}

export class SendSellerEmailsDto {
  @IsEnum(['email1', 'email2'])
  kind!: SellerEmailKind;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SellerEmailRecipientDto)
  recipients!: SellerEmailRecipientDto[];

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
