import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
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
  CreditApplicationStatus,
  CreditInsuranceClaimStatus,
  CreditInsuranceStatus,
  CreditTransactionType,
  DocumentCategory,
} from '../../../generated/prisma/client.js';
import { AdminListQueryDto } from '../common/admin-query.dto.js';

export class AdminCreditApplicationsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: CreditApplicationStatus })
  @IsOptional()
  @IsEnum(CreditApplicationStatus)
  status?: CreditApplicationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;
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
