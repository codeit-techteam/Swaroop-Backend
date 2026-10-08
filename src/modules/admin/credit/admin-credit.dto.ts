import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CreditAccountStatus,
  CreditApplicationSource,
  CreditApplicationStatus,
  CreditInsuranceClaimStatus,
  CreditInsuranceStatus,
  CreditTransactionType,
  DocumentCategory,
} from '../../../generated/prisma/client.js';
import { AdminListQueryDto } from '../common/admin-query.dto.js';

export const CREDIT_APPLICATION_STATUS_FILTERS = [
  ...Object.values(CreditApplicationStatus),
  'RESUBMISSION_REQUIRED',
] as const;

export type CreditApplicationStatusFilter =
  (typeof CREDIT_APPLICATION_STATUS_FILTERS)[number];

export const CREDIT_APPLICATION_SOURCE_FILTERS = [
  ...Object.values(CreditApplicationSource),
  'NOT_RECORDED',
] as const;

export type CreditApplicationSourceFilter =
  (typeof CREDIT_APPLICATION_SOURCE_FILTERS)[number];

/** Admin-facing KYC buckets mapped onto Organization.verificationStatus. */
export const CREDIT_KYC_FILTERS = [
  'VERIFIED',
  'PENDING',
  'FAILED',
  'MANUAL_REVIEW',
] as const;

export type CreditKycFilter = (typeof CREDIT_KYC_FILTERS)[number];

export const CREDIT_APPLICATION_SORTS = [
  'newest',
  'oldest',
  'submitted_desc',
  'submitted_asc',
  'updated_desc',
  'amount_desc',
  'amount_asc',
] as const;

export type CreditApplicationSort = (typeof CREDIT_APPLICATION_SORTS)[number];

export class AdminCreditApplicationsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({
    enum: CREDIT_APPLICATION_STATUS_FILTERS,
    description:
      'Application status. PENDING is shown as "Submitted"; RESUBMISSION_REQUIRED matches drafts reopened by an admin.',
  })
  @IsOptional()
  @IsIn(CREDIT_APPLICATION_STATUS_FILTERS)
  status?: CreditApplicationStatusFilter;

  @ApiPropertyOptional({
    enum: CREDIT_APPLICATION_SOURCE_FILTERS,
    description:
      'NOT_RECORDED matches applications created before source tracking.',
  })
  @IsOptional()
  @IsIn(CREDIT_APPLICATION_SOURCE_FILTERS)
  source?: CreditApplicationSourceFilter;

  @ApiPropertyOptional({ enum: CREDIT_KYC_FILTERS })
  @IsOptional()
  @IsIn(CREDIT_KYC_FILTERS)
  kycStatus?: CreditKycFilter;

  @ApiPropertyOptional({ enum: CREDIT_APPLICATION_SORTS, default: 'newest' })
  @IsOptional()
  @IsIn(CREDIT_APPLICATION_SORTS)
  sort?: CreditApplicationSort;

  @ApiPropertyOptional({
    description: 'Include never-submitted drafts (default true).',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === true || value === 'true',
  )
  @IsBoolean()
  includeDrafts?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    description: 'Only applications assigned to this admin.',
  })
  @IsOptional()
  @IsUUID()
  assignedAdminId?: string;
}

export class AdminCreditApplicationStatsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class AdminCreditAssignDto {
  @ApiPropertyOptional({
    description: 'Admin user to assign. Omit to assign yourself.',
  })
  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;
}

export class AdminCreditRemarkDto {
  @ApiProperty({ description: 'Internal remark; never shown to the customer.' })
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  remark!: string;
}

export class AdminCreditRequestResubmissionDto {
  @ApiProperty({
    description: 'What the customer must change. Shown to the customer.',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  message!: string;
}

export class AdminCreditAccountsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: CreditAccountStatus })
  @IsOptional()
  @IsEnum(CreditAccountStatus)
  status?: CreditAccountStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

export class AdminCreditTransactionsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: CreditTransactionType })
  @IsOptional()
  @IsEnum(CreditTransactionType)
  type?: CreditTransactionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

export class AdminCreditRepaymentsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

export class AdminCreditDocumentsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ enum: DocumentCategory })
  @IsOptional()
  @IsEnum(DocumentCategory)
  category?: DocumentCategory;
}

export class AdminCreditAuditQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

export class AdminCreditApproveDto {
  @ApiProperty({ example: 5000000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  approvedLimit!: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  creditTermDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  reviewAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @ApiPropertyOptional({
    description: 'Customer-facing message. Internal notes go in `reason`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customerMessage?: string;
}

/** Same payload as approve; results in PARTIALLY_APPROVED. */
export class AdminCreditPartialApproveDto extends AdminCreditApproveDto {}

export class AdminCreditRejectDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({
    description: 'Customer-facing message. Defaults to `reason`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customerMessage?: string;
}

export class AdminCreditInsuranceReviewDto {
  @ApiPropertyOptional({ example: 'ICICI Lombard' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  insurancePartner?: string;

  @ApiPropertyOptional({ example: 'REF-99213' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  insuranceReference?: string;

  @ApiPropertyOptional({ example: 2500000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  insuredAmount?: number;

  @ApiPropertyOptional({ description: 'Customer-facing message' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customerMessage?: string;

  @ApiPropertyOptional({ description: 'Internal notes' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class AdminCreditArrangementDto {
  @ApiPropertyOptional({ example: 'ICICI Lombard' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  insurancePartner?: string;

  @ApiPropertyOptional({ example: 'POL-2026-0031' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  insuranceReference?: string;

  @ApiPropertyOptional({ example: 2500000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  insuredAmount?: number;

  @ApiPropertyOptional({ description: 'Customer-facing message' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customerMessage?: string;

  @ApiPropertyOptional({ description: 'Internal notes' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class AdminCreditDocumentVerifyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class AdminCreditDocumentRejectDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}

export class AdminCreditRequestDocumentsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  documentTypes?: string[];
}

export class AdminCreditAdjustLimitDto {
  @ApiProperty({ example: 7500000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  newLimit!: number;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}

export class AdminCreditAccountActionDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}

export class AdminCreditInsuranceUpdateDto {
  @ApiPropertyOptional({ enum: CreditInsuranceStatus })
  @IsOptional()
  @IsEnum(CreditInsuranceStatus)
  status?: CreditInsuranceStatus;

  @ApiPropertyOptional({ enum: CreditInsuranceClaimStatus })
  @IsOptional()
  @IsEnum(CreditInsuranceClaimStatus)
  claimStatus?: CreditInsuranceClaimStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  providerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  policyNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  coverageAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class AdminCreditRequestDocumentDto {
  @ApiProperty({ enum: DocumentCategory })
  @IsEnum(DocumentCategory)
  category!: DocumentCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
