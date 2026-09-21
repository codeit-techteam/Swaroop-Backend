import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';

export class CustomerOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['ACTIVE', 'COMPLETED', 'CANCELLED', 'active', 'completed', 'cancelled'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['ACTIVE', 'COMPLETED', 'CANCELLED', 'active', 'completed', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by payment status' })
  @IsOptional()
  @IsString()
  paymentStatus?: string;

  @ApiPropertyOptional({ description: 'ISO date from (inclusive)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date to (inclusive)' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: 'Search by PO / order number' })
  @IsOptional()
  @IsString()
  orderNumber?: string;
}

export class CustomerOrderIdParamDto {
  @IsUUID()
  id!: string;
}
