import { IsOptional, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class BuyerOrdersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @Type(() => String)
  search?: string;

  @IsOptional()
  @IsIn(['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'])
  status?: string;
}

