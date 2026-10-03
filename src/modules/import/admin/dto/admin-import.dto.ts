import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
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
import {
  DocumentCategory,
  DocumentStatus,
  EntityOwnerType,
  ImportDealStatus,
  ImportListingStatus,
  ImportMatchStatus,
  ImportNegotiationStatus,
  ImportSide,
  IncotermPriceBasis,
  MasterStatus,
  PortType,
} from '../../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../../master-data/common/pagination.js';

export const IMPORT_MASTER_ENTITIES = [
  'currencies',
  'incoterms',
  'brands',
  'ports',
  'packaging',
  'document-requirements',
  'countries',
] as const;
export type ImportMasterEntity = (typeof IMPORT_MASTER_ENTITIES)[number];

/** Union of fields across Import master entities; the service whitelists per entity. */
export class ImportMasterRecordDto {
  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9_-]+$/)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: '$' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  symbol?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  decimalPlaces?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  importEnabled?: boolean;

  @ApiPropertyOptional({ enum: IncotermPriceBasis })
  @IsOptional()
  @IsEnum(IncotermPriceBasis)
  priceBasis?: IncotermPriceBasis;

  @ApiPropertyOptional({ description: 'Country (Location COUNTRY) id' })
  @IsOptional()
  @IsUUID()
  countryId?: string;

  @ApiPropertyOptional({ enum: PortType })
  @IsOptional()
  @IsEnum(PortType)
  type?: PortType;

  @ApiPropertyOptional({ enum: DocumentCategory })
  @IsOptional()
  @IsEnum(DocumentCategory)
  documentCategory?: DocumentCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;
}

export class ImportMasterQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(MasterStatus)
  status?: MasterStatus;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  countryCode?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  override limit?: number = 50;
}

export class UpdateImportSettingsDto {
  @ApiPropertyOptional({
    description: 'Criterion → weight (non-negative). Scores are normalised.',
  })
  @IsOptional()
  @IsObject()
  matchWeights?: Record<string, number>;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minMatchScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowCustomGrade?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  nearExpiryHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2160)
  negotiationTtlHours?: number;

  @ApiPropertyOptional({
    description: 'Days a published BUY request stays open (set by the server).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  buyRequestValidityDays?: number;
}

export class AdminListingsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(ImportSide) side?: ImportSide;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsEnum(ImportListingStatus, { each: true })
  status?: ImportListingStatus[];

  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() gradeId?: string;
  @IsOptional() @IsUUID() originCountryId?: string;
  @IsOptional() @IsString() @MaxLength(3) currencyCode?: string;
  @IsOptional() @IsUUID() incotermId?: string;
  @IsOptional() @IsUUID() polId?: string;
  @IsOptional() @IsUUID() podId?: string;
  @IsOptional() @IsUUID() ownerOrgId?: string;
  @IsOptional() @IsDateString() createdFrom?: string;
  @IsOptional() @IsDateString() createdTo?: string;

  @IsOptional()
  @IsIn(['createdAt', 'validUntil', 'publishedAt', 'price', 'quantity'])
  override sortBy?: string = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  override sortOrder?: 'asc' | 'desc' = 'desc';
}

export class AdminListingStatusDto {
  @IsIn([
    ImportListingStatus.PAUSED,
    ImportListingStatus.PUBLISHED,
    ImportListingStatus.CANCELLED,
    ImportListingStatus.EXPIRED,
  ])
  status!: ImportListingStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AdminNegotiationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ImportNegotiationStatus)
  status?: ImportNegotiationStatus;
  @IsOptional() @IsUUID() listingId?: string;
}

export class AdminDealsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(ImportDealStatus) status?: ImportDealStatus;
}

export class AdminDealStatusDto {
  @IsIn([
    ImportDealStatus.CANCELLED,
    ImportDealStatus.PARTIALLY_FULFILLED,
    ImportDealStatus.FULFILLED,
  ])
  status!: ImportDealStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AdminImportDocumentsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(ImportSide) side?: ImportSide;
  @IsOptional() @IsUUID() listingId?: string;
  @IsOptional() @IsUUID() dealId?: string;
  @IsOptional() @IsUUID() ownerOrgId?: string;
  @IsOptional() @IsEnum(DocumentCategory) category?: DocumentCategory;
  @IsOptional() @IsEnum(DocumentStatus) status?: DocumentStatus;
  @IsOptional() @IsDateString() createdFrom?: string;
  @IsOptional() @IsDateString() createdTo?: string;
}

export class AdminImportDocumentDownloadQueryDto {
  @IsOptional()
  @IsIn(['inline', 'attachment'])
  disposition?: 'inline' | 'attachment';
}

export const IMPORT_AUDIT_ENTITY_TYPES = [
  EntityOwnerType.IMPORT_LISTING,
  EntityOwnerType.IMPORT_NEGOTIATION,
  EntityOwnerType.IMPORT_DEAL,
  EntityOwnerType.IMPORT_MASTER,
  EntityOwnerType.IMPORT_SHIPMENT,
] as const;

export class AdminImportAuditQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(IMPORT_AUDIT_ENTITY_TYPES)
  entityType?: (typeof IMPORT_AUDIT_ENTITY_TYPES)[number];

  @IsOptional() @IsUUID() entityId?: string;
  @IsOptional() @IsUUID() actorUserId?: string;
  @IsOptional() @IsUUID() organizationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Z_]+$/)
  action?: string;

  @IsOptional() @IsDateString() createdFrom?: string;
  @IsOptional() @IsDateString() createdTo?: string;
}

export class AdminMatchesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minScore?: number;

  @IsOptional() @IsEnum(ImportMatchStatus) status?: ImportMatchStatus;
}
