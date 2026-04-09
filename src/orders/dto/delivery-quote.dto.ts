import { IsUUID } from 'class-validator';

export class DeliveryQuoteDto {
  @IsUUID()
  addressId: string;
}

