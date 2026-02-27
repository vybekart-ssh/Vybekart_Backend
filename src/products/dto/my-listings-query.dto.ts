import { IsOptional, IsString, IsIn } from 'class-validator';

export class MyListingsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['all', 'active', 'draft', 'out_of_stock'])
  status?: string;
}
