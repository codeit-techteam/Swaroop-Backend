import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PaymentMethod } from '../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';

export class CustomerOfferQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  gradeId?: string;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minMoq?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxMoq?: number;

  @ApiPropertyOptional({
    description: 'Match warehouse city/state (contains, case-insensitive)',
  })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({
    enum: ['basePrice', 'moq', 'createdAt', 'validUntil'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['basePrice', 'moq', 'createdAt', 'validUntil'])
  override sortBy?: 'basePrice' | 'moq' | 'createdAt' | 'validUntil' =
    'createdAt';
}
