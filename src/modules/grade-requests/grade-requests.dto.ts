import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { NewGradeRequestStatus } from '../../generated/prisma/client.js';
import { PaginationQueryDto } from '../master-data/common/pagination.js';
import {
  GRADE_REQUEST_DOCUMENT_TYPES,
  GRADE_REQUEST_UNITS,
} from './grade-requests.shared.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateGradeRequestDto {
  // ---- Material --------------------------------------------------------------
  @ApiProperty({
    example: 'F4811 Masterbatch',
    description: 'Requested grade name / number',
  })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  gradeName!: string;

  @ApiProperty({ example: 'White Masterbatch' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  materialCategory!: string;

  @ApiPropertyOptional({
    description: 'Catalogue category, when the customer picked one',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  manufacturer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  gradeGroup?: string;

  @ApiPropertyOptional({ description: 'Application / intended usage' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  application?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  technicalSpecs?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  remarks?: string;

  // ---- Commercial ------------------------------------------------------------
  @ApiProperty({ example: 25 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  quantity!: number;

  @ApiProperty({ enum: GRADE_REQUEST_UNITS, default: 'MT' })
  @IsIn(GRADE_REQUEST_UNITS as unknown as string[])
  unit!: (typeof GRADE_REQUEST_UNITS)[number];

  @ApiProperty({ example: 'Mundra, Gujarat' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  deliveryLocation!: string;

  @ApiPropertyOptional({ example: '370421' })
  @IsOptional()
  @Matches(/^[1-9][0-9]{5}$/, {
    message: 'deliveryPincode must be a 6-digit pincode',
  })
  deliveryPincode?: string;

  @ApiPropertyOptional({
    description: 'Saved customer address used for delivery',
  })
  @IsOptional()
  @IsUUID()
  deliveryAddressId?: string;

  @ApiPropertyOptional({ example: '2026-12-15' })
  @IsOptional()
  @IsISO8601({ strict: true })
  requiredByDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  preferredPackaging?: string;

  // ---- Contact ---------------------------------------------------------------
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  contactName!: string;

  @ApiProperty({ example: '9876543210' })
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  contactPhone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(160)
  contactEmail?: string;

  @ApiPropertyOptional({
    description: 'Client-generated key making retries safe',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description:
      'Set true to submit even though catalogue grades with the same grade number/code exist.',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeExisting?: boolean;
}

export class CustomerGradeRequestQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NewGradeRequestStatus })
  @IsOptional()
  @IsEnum(NewGradeRequestStatus)
  status?: NewGradeRequestStatus;
}

export class GradeRequestRespondDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  message!: string;
}

export class GradeRequestCancelDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class GradeRequestDocumentDto {
  @ApiProperty({ enum: GRADE_REQUEST_DOCUMENT_TYPES })
  @IsIn(GRADE_REQUEST_DOCUMENT_TYPES as unknown as string[])
  documentType!: (typeof GRADE_REQUEST_DOCUMENT_TYPES)[number];

  @ApiProperty({ example: 'datasheet.pdf' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  mimeType!: string;

  @ApiProperty({ example: 524288 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25 * 1024 * 1024)
  fileSizeBytes!: number;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export class AdminGradeRequestQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NewGradeRequestStatus })
  @IsOptional()
  @IsEnum(NewGradeRequestStatus)
  status?: NewGradeRequestStatus;

  @ApiPropertyOptional({ description: "'me' | 'unassigned' | admin user id" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignee?: string;

  @ApiPropertyOptional({
    description: 'Exact manufacturer filter (case-insensitive)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  manufacturer?: string;
}

export class AdminAssignDto {
  @ApiPropertyOptional({ description: 'Defaults to the calling admin' })
  @IsOptional()
  @IsUUID()
  adminUserId?: string;
}

export class AdminStatusDto {
  @ApiProperty({ enum: NewGradeRequestStatus })
  @IsEnum(NewGradeRequestStatus)
  status!: NewGradeRequestStatus;

  @ApiPropertyOptional({
    description: 'Shown to the customer. Required for REJECTED/CLOSED.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  message?: string;
}

export class AdminRequestInfoDto {
  @ApiProperty({
    description: 'What the customer must provide (shown to the customer)',
  })
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  message!: string;
}

export class AdminNoteDto {
  @ApiProperty({ description: 'Internal note — never shown to the customer' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  note!: string;
}

export class AdminMapGradeDto {
  @ApiProperty()
  @IsUUID()
  gradeId!: string;

  @ApiPropertyOptional({ description: 'Optional customer-visible message' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional({ description: 'Internal note' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  note?: string;
}

export class AdminCreateGradeFromRequestDto {
  @ApiProperty({ example: 'F4811' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  code!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  manufacturer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  gradeGroup?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  gradeNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  applicationCodes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  hsnCode?: string;

  @ApiPropertyOptional({ description: 'Customer-visible message' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
