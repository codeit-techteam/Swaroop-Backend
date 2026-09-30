import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  SELLER_ONBOARDING_SLOT_VALUES,
  SELLER_ONBOARDING_UPLOAD_SOURCES,
  type SellerOnboardingUploadSource,
} from './onboarding-documents.slots.js';

/** DTO ceiling. Runtime limit is StorageService.getMaxDocumentSizeBytes(). */
const ONBOARDING_DOCUMENT_DTO_MAX_BYTES = 50 * 1024 * 1024;

export class CreateOnboardingDocumentDto {
  @ApiProperty({
    enum: SELLER_ONBOARDING_SLOT_VALUES,
    example: 'gst',
  })
  @IsIn(SELLER_ONBOARDING_SLOT_VALUES)
  slot!: (typeof SELLER_ONBOARDING_SLOT_VALUES)[number];

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

  @ApiProperty({ example: 245_760 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ONBOARDING_DOCUMENT_DTO_MAX_BYTES)
  fileSizeBytes!: number;

  @ApiPropertyOptional({
    enum: SELLER_ONBOARDING_UPLOAD_SOURCES,
    description:
      'Client that uploaded the file; shown to admins in the Document Center',
  })
  @IsOptional()
  @IsIn(SELLER_ONBOARDING_UPLOAD_SOURCES)
  source?: SellerOnboardingUploadSource;
}
