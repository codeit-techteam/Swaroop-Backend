import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const SELLER_WORKBENCH_STAGES = [
  'PR',
  'COMMERCIAL_REVIEW',
  'PRICE_REVISION',
  'PO',
  'PAYMENT',
  'DISPATCH',
  'SHIPMENT',
  'SETTLEMENT',
] as const;

export type SellerWorkbenchStage = (typeof SELLER_WORKBENCH_STAGES)[number];

export const SELLER_WORKBENCH_PAYMENT_STATUSES = [
  'PAYMENT_PENDING',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
] as const;

export type SellerWorkbenchPaymentStatus =
  (typeof SELLER_WORKBENCH_PAYMENT_STATUSES)[number];

export const SELLER_WORKBENCH_DISPATCH_STATUSES = [
  'NOT_STARTED',
  'READY_FOR_DISPATCH',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
] as const;

export type SellerWorkbenchDispatchStatus =
  (typeof SELLER_WORKBENCH_DISPATCH_STATUSES)[number];

export const SELLER_WORKBENCH_PRIORITIES = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
] as const;

export type SellerWorkbenchPriority =
  (typeof SELLER_WORKBENCH_PRIORITIES)[number];

export const SELLER_WORKBENCH_ALERTS = [
  'PRICE_REVISION_DUE_TODAY',
  'PAYMENT_PENDING',
  'VEHICLE_SLOT_MISSING',
  'PO_AWAITING_CONFIRMATION',
  'DOCUMENTS_MISSING',
  'DISPATCH_DELAYED',
] as const;

export type SellerWorkbenchAlert = (typeof SELLER_WORKBENCH_ALERTS)[number];

/**
 * Seller Procurement Workbench list query.
 * Intentionally omits buyer/customer filter params.
 */
export class SellerProcurementWorkbenchQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  /** Safe search: PR / PO / Order / Product / Grade only — never buyer identity. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn([...SELLER_WORKBENCH_STAGES])
  stage?: SellerWorkbenchStage;

  @IsOptional()
  @IsString()
  gradeId?: string;

  @IsOptional()
  @IsIn([...SELLER_WORKBENCH_PRIORITIES])
  priority?: SellerWorkbenchPriority;

  @IsOptional()
  @IsIn([...SELLER_WORKBENCH_PAYMENT_STATUSES])
  paymentStatus?: SellerWorkbenchPaymentStatus;

  @IsOptional()
  @IsIn([...SELLER_WORKBENCH_DISPATCH_STATUSES])
  dispatchStatus?: SellerWorkbenchDispatchStatus;

  @IsOptional()
  @IsIn([...SELLER_WORKBENCH_ALERTS])
  alert?: SellerWorkbenchAlert;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

  /** Exact calendar day filter (YYYY-MM-DD) on lastUpdated. */
  @IsOptional()
  @IsDateString()
  date?: string;
}
