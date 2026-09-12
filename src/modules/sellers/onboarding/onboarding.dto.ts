import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

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
