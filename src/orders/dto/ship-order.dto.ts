import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ShipOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  trackingId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  carrierName: string;
}
