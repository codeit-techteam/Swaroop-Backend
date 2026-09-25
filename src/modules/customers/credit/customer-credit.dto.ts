import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CREDIT_APPLICATION_DOCUMENT_TYPES,
  type CreditApplicationDocumentType,
} from '../../payments/common/credit-workflow.js';

export const CREDIT_DOCUMENT_MAX_SIZE_BYTES = 25 * 1024 * 1024;

export class CustomerCreditApplyDto {
  @ApiProperty({ example: 2500000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  requestedLimit!: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  requestedTenureDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  purpose?: string;

  @ApiPropertyOptional({
    type: Object,
    description:
      'Free-form applicant details, e.g. { monthlyPurchase: 500000 }',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/** Create or update the single open draft application. */
export class CustomerCreditDraftDto extends CustomerCreditApplyDto {}

export class CustomerCreditDocumentUploadDto {
  @ApiProperty({
    enum: CREDIT_APPLICATION_DOCUMENT_TYPES,
    example: 'gst_registration',
  })
  @IsIn(CREDIT_APPLICATION_DOCUMENT_TYPES as unknown as string[])
  documentType!: CreditApplicationDocumentType;

  @ApiProperty({ example: 'gst-registration.pdf' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({
    example: 'application/pdf',
    description: 'Allowed: application/pdf, image/jpeg, image/png, image/webp',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  mimeType!: string;

  @ApiProperty({ example: 1_048_576 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CREDIT_DOCUMENT_MAX_SIZE_BYTES)
  fileSizeBytes!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  fileType?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CustomerCreditDocumentReplaceDto {
  @ApiProperty({ example: 'gst-registration-v2.pdf' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  mimeType!: string;

  @ApiProperty({ example: 1_048_576 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CREDIT_DOCUMENT_MAX_SIZE_BYTES)
  fileSizeBytes!: number;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CustomerCreditResubmitDocumentsDto {
  @ApiPropertyOptional({
    description: 'Optional note for the credit reviewer',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
