import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  Min,
  IsUrl,
  IsUUID,
  IsBoolean,
  IsObject,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  stock?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  images?: string[];

  @IsOptional()
  @IsUrl()
  videoUrl?: string;

  @IsString()
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  // Step 1 – Basic info
  @IsString()
  @IsOptional()
  material?: string;

  @IsString()
  @IsOptional()
  suitableForOccasion?: string;

  // Step 3 – Inventory & pricing
  @IsString()
  @IsOptional()
  status?: 'DRAFT' | 'ACTIVE' | 'OUT_OF_STOCK';

  @IsNumber()
  @Min(0)
  @IsOptional()
  mrp?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  discountPercent?: number;

  @IsString()
  @IsOptional()
  priceType?: string;

  @IsString()
  @IsOptional()
  sku?: string;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsString()
  @IsOptional()
  hsnCode?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  gstPercent?: number;

  // Step 4 – Logistics & policies
  @IsNumber()
  @Min(0)
  @IsOptional()
  weightKg?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  lengthCm?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  widthCm?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  heightCm?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  leadTimeDays?: number;

  @IsBoolean()
  @IsOptional()
  returnable?: boolean;

  @IsString()
  @IsOptional()
  refundType?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  returnWindowDays?: number;

  // Step 2 – Variants (e.g. [{ optionName: "Size", optionValues: ["S","M","L"] }])
  @IsObject()
  @IsOptional()
  variants?: Record<string, unknown>;
}
