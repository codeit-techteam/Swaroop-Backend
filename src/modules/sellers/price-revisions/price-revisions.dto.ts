import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';

export const SELLER_PRICE_REVISION_STATUSES = [
  'PENDING',
  'AWAITING_RESPONSE',
  'COUNTER_OFFER',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
] as const;

export class SellerPriceRevisionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: [...SELLER_PRICE_REVISION_STATUSES, 'ALL'] })
  @IsOptional()
  @IsString()
  @IsIn([...SELLER_PRICE_REVISION_STATUSES, 'ALL', 'all'])
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by grade id' })
  @IsOptional()
  @IsUUID()
  gradeId?: string;

  @ApiPropertyOptional({ description: 'ISO date from (inclusive)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date to (inclusive)' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    enum: ['newest', 'oldest', 'highest', 'lowest'],
    description: 'Sort mode',
  })
  @IsOptional()
  @IsString()
  @IsIn(['newest', 'oldest', 'highest', 'lowest'])
  sort?: string;
}

export class SellerPriceRevisionCounterDto {
  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  counterPrice!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  counterQuantity?: number;
}

export class SellerPriceRevisionRejectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}

export class SellerPriceRevisionAcceptDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
