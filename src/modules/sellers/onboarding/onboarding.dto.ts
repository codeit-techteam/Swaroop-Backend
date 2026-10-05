import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  KYC_VERIFICATION_SOURCES,
  type KycVerificationSource,
} from '../../kyc-verification/kyc-verification.types.js';

const SELLER_VERIFICATION_SOURCES = KYC_VERIFICATION_SOURCES.filter(
  (source) => source === 'SELLER_APP' || source === 'SELLER_WEB',
);

const upperTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Format and checksum are validated in the service so the message stays user-friendly. */
export class VerifySellerPanDto {
  @ApiProperty({ example: 'AAPFU0939F' })
  @Transform(upperTrim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  pan!: string;

  @ApiProperty({
    example: 'KARAN VEER INDUSTRIES PRIVATE LIMITED',
    description: 'Name exactly as printed on the PAN',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  fullName!: string;

  @ApiProperty({
    example: '2018-10-12',
    description:
      'Date of birth (individual PAN) or date of incorporation (company / firm PAN), YYYY-MM-DD',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dob must be YYYY-MM-DD' })
  dob!: string;

  @ApiPropertyOptional({ enum: SELLER_VERIFICATION_SOURCES })
  @IsOptional()
  @IsIn(SELLER_VERIFICATION_SOURCES)
  source?: KycVerificationSource;
}

export class VerifySellerGstDto {
  @ApiProperty({ example: '27AAPFU0939F1ZV' })
  @Transform(upperTrim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  gstin!: string;

  @ApiPropertyOptional({ enum: SELLER_VERIFICATION_SOURCES })
  @IsOptional()
  @IsIn(SELLER_VERIFICATION_SOURCES)
  source?: KycVerificationSource;
}

export class CreateOnboardingDto {
  @ApiPropertyOptional({ example: 'Acme Polymers Pvt Ltd' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ example: 'company' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  currentStep?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  companyData?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  businessData?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  gstData?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  panData?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  bankData?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  addressData?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  locationData?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  completedSteps?: string[];

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateOnboardingDto {
  @ApiPropertyOptional({ example: 'gst' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  currentStep?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  companyData?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  businessData?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  gstData?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  panData?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  bankData?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  addressData?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  locationData?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  completedSteps?: string[];

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewNotes?: string;
}

export class OnboardingQueryDto {
  @ApiPropertyOptional({
    description: 'Required for ADMIN/SUPER_ADMIN review of another seller',
  })
  @IsOptional()
  @IsString()
  sellerProfileId?: string;
}

/** Nested shape documentation for Swagger only */
export class OnboardingSubmitBodyDto {
  @ApiPropertyOptional({
    description: 'Optional notes included with submission',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
