import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';

export const ADMIN_KYC_ENTITY_TYPES = ['SELLER', 'CUSTOMER'] as const;
export type AdminKycEntityType = (typeof ADMIN_KYC_ENTITY_TYPES)[number];

export const ADMIN_KYC_STATUSES = [
  'PENDING',
  'UNDER_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
] as const;
export type AdminKycStatus = (typeof ADMIN_KYC_STATUSES)[number];

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class AdminKycQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ADMIN_KYC_ENTITY_TYPES })
  @IsOptional()
  @IsIn(ADMIN_KYC_ENTITY_TYPES)
  entityType?: AdminKycEntityType;

  @ApiPropertyOptional({ enum: ADMIN_KYC_STATUSES })
  @IsOptional()
  @IsIn(ADMIN_KYC_STATUSES)
  status?: AdminKycStatus;
}

export class AdminKycDownloadQueryDto {
  @ApiPropertyOptional({ enum: ['inline', 'attachment'] })
  @IsOptional()
  @IsIn(['inline', 'attachment'])
  disposition?: 'inline' | 'attachment';
}

export class AdminKycApproveDto {
  @ApiPropertyOptional({ example: 'All documents match GST portal records' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class AdminKycRejectDto {
  @ApiProperty({ example: 'GSTIN is cancelled on the GST portal' })
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reason!: string;
}

export class AdminKycRequestChangesDto {
  @ApiProperty({
    example: 'PAN copy is blurred. Upload a clear scan of the original.',
  })
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Documents that must be re-uploaded. They are marked rejected with the reason.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  documentIds?: string[];
}
