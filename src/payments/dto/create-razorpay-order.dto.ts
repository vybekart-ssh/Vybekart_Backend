import { IsUUID } from 'class-validator';

export class CreateRazorpayOrderDto {
  @IsUUID()
  addressId!: string;
}
