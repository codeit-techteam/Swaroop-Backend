import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';

/** Seller-facing display statuses (mapped from PurchaseOrder + logistics). */
export const SELLER_ORDER_DISPLAY_STATUSES = [
  'CONFIRMED',
  'PROCESSING',
  'READY_FOR_DISPATCH',
  'DISPATCHED',
  'DELIVERED',
  'CANCELLED',
] as const;

export type SellerOrderDisplayStatus =
  (typeof SELLER_ORDER_DISPLAY_STATUSES)[number];

export class SellerOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: [
      ...SELLER_ORDER_DISPLAY_STATUSES,
      'ALL',
      'all',
      'confirmed',
      'processing',
      'ready_for_dispatch',
      'dispatched',
      'in_transit',
      'delivered',
      'cancelled',
    ],
    description:
      'Seller UI status filter. Mapped to PurchaseOrder + logistics states.',
  })
  @IsOptional()
  @IsString()
  @IsIn([
    'CONFIRMED',
    'PROCESSING',
    'READY_FOR_DISPATCH',
    'DISPATCHED',
    'DELIVERED',
    'CANCELLED',
    'ALL',
    'all',
    'confirmed',
    'processing',
    'ready_for_dispatch',
    'dispatched',
    'in_transit',
    'delivered',
    'cancelled',
  ])
  status?: string;

  @ApiPropertyOptional({ description: 'ISO date from (inclusive)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date to (inclusive)' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
