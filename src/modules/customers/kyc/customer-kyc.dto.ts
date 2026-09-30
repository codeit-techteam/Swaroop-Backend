import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CUSTOMER_KYC_SLOT_VALUES,
  CUSTOMER_KYC_UPLOAD_SOURCES,
  type CustomerKycUploadSource,
} from './customer-kyc.slots.js';

/** DTO ceiling. Runtime limit is StorageService.getMaxDocumentSizeBytes(). */
const KYC_DOCUMENT_DTO_MAX_BYTES = 50 * 1024 * 1024;

const upperTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateCustomerKycDocumentDto {
  @ApiProperty({ enum: CUSTOMER_KYC_SLOT_VALUES, example: 'pan' })
  @IsIn(CUSTOMER_KYC_SLOT_VALUES)
  slot!: (typeof CUSTOMER_KYC_SLOT_VALUES)[number];

  @ApiProperty({ example: 'pan-card.pdf' })
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

  @ApiProperty({ example: 245_760 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(KYC_DOCUMENT_DTO_MAX_BYTES)
  fileSizeBytes!: number;

  @ApiPropertyOptional({ enum: CUSTOMER_KYC_UPLOAD_SOURCES })
  @IsOptional()
  @IsIn(CUSTOMER_KYC_UPLOAD_SOURCES)
  source?: CustomerKycUploadSource;
}

export class SubmitCustomerKycDto {
  @ApiPropertyOptional({ example: 'Karan Veer Industries Pvt Ltd' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  businessName?: string;

  @ApiPropertyOptional({ example: '27AAPFU0939F1ZV' })
  @IsOptional()
  @Transform(upperTrim)
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, {
    message: 'gstin must be a valid 15-character GSTIN',
  })
  gstin?: string;

  @ApiPropertyOptional({ example: 'AAPFU0939F' })
  @IsOptional()
  @Transform(upperTrim)
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, {
    message: 'pan must be a valid 10-character PAN',
  })
  pan?: string;
}
