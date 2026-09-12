import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  DocumentCategory,
  DocumentStatus,
} from '../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';

export const CUSTOMER_DOCUMENT_MAX_SIZE_BYTES = 50 * 1024 * 1024;

export class CreateCustomerDocumentDto {
  @ApiProperty({ enum: DocumentCategory, example: DocumentCategory.KYC })
  @IsEnum(DocumentCategory)
  category!: DocumentCategory;

  @ApiProperty({ example: 'kyc-pan.pdf' })
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
  @Max(CUSTOMER_DOCUMENT_MAX_SIZE_BYTES)
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

export class ReplaceCustomerDocumentDto {
  @ApiProperty({ example: 'kyc-pan-v2.pdf' })
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
  @Max(CUSTOMER_DOCUMENT_MAX_SIZE_BYTES)
  fileSizeBytes!: number;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CustomerDocumentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DocumentCategory })
  @IsOptional()
  @IsEnum(DocumentCategory)
  category?: DocumentCategory;

  @ApiPropertyOptional({ enum: DocumentStatus })
  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;
}
