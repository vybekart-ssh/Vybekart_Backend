import { IsUUID } from 'class-validator';

export class ReplacementVariantOptionsQueryDto {
  @IsUUID()
  orderItemId!: string;
}
