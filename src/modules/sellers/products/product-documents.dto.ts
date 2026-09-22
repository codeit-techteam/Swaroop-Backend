import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const PRODUCT_DOCUMENT_TYPE_VALUES = [
  'TDS',
  'MDS',
  'MSDS',
  'SDS',
  'COA',
  'TECHNICAL_SPECIFICATION',
  'PRODUCT_SPECIFICATION',
  'QUALITY_CERTIFICATE',
  'TEST_CERTIFICATE',
  'COMPLIANCE_CERTIFICATE',
  'PRODUCT_TDS',
  'ISO',
  'OTHER',
] as const;

export class UploadProductDocumentDto {
  @ApiProperty({
    enum: PRODUCT_DOCUMENT_TYPE_VALUES,
    example: 'TDS',
  })
  @IsString()
  @IsIn(PRODUCT_DOCUMENT_TYPE_VALUES as unknown as string[])
  documentType!: string;

  @ApiPropertyOptional({ example: 'Technical Data Sheet' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 'tds.pdf' })
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
  @Max(50 * 1024 * 1024)
  fileSizeBytes!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  fileType?: string;

  @ApiPropertyOptional({
    description: 'Attach document to a specific offer (seller-scoped COA etc.)',
  })
  @IsOptional()
  @IsUUID()
  offerId?: string;
}

export class ReplaceProductDocumentDto {
  @ApiProperty({ example: 'tds-v2.pdf' })
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
  @Max(50 * 1024 * 1024)
  fileSizeBytes!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class PatchProductDocumentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  customerVisible?: boolean;
}
