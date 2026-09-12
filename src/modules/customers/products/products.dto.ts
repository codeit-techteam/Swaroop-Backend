import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';

export class CustomerProductQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  gradeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    enum: ['createdAt', 'name', 'code'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['createdAt', 'name', 'code'])
  override sortBy?: 'createdAt' | 'name' | 'code' = 'createdAt';
}
