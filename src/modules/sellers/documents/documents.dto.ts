import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
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

export const SELLER_DOCUMENT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** Soft max for DTO validation; runtime uses StorageService.getMaxDocumentSizeBytes(). */
export const SELLER_DOCUMENT_MAX_SIZE_BYTES = 50 * 1024 * 1024;

export class UploadDocumentDto {
  @ApiProperty({ enum: DocumentCategory, example: DocumentCategory.GST })
  @IsEnum(DocumentCategory)
  category!: DocumentCategory;

  @ApiProperty({ example: 'gst-certificate.pdf' })
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

  @ApiProperty({
    example: 1_048_576,
    description: 'Declared file size in bytes (max 10MB)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SELLER_DOCUMENT_MAX_SIZE_BYTES)
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

export class RegisterDocumentDto extends UploadDocumentDto {
  @ApiProperty({
    example: 'sellers/{sellerId}/documents/gst-certificate.pdf',
    description: 'Storage key after client completed the signed PUT upload',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  storageKey!: string;

  @ApiPropertyOptional({ enum: DocumentStatus })
  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;
}

export class ReplaceDocumentDto {
  @ApiProperty({ example: 'gst-certificate-v2.pdf' })
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
  @Max(SELLER_DOCUMENT_MAX_SIZE_BYTES)
  fileSizeBytes!: number;

  @ApiPropertyOptional({
    description:
      'If omitted, a new storage key is generated and a signed PUT URL is returned',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  storageKey?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class DocumentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DocumentCategory })
  @IsOptional()
  @IsEnum(DocumentCategory)
  category?: DocumentCategory;

  @ApiPropertyOptional({ enum: DocumentStatus })
  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sellerProfileId?: string;
}
