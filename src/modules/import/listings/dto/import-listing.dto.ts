import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ImportContainerSize,
  ImportGstTreatment,
  ImportInspectionType,
  ImportListingStatus,
  ImportPriceType,
  ImportQuantityUnit,
  ImportReadyStockType,
  ImportShipmentPermission,
  ImportShipmentType,
} from '../../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../../master-data/common/pagination.js';

/** Quantities/prices travel as decimal strings so no float rounding ever happens. */
const QTY = /^\d{1,15}(\.\d{1,3})?$/;
const PRICE = /^\d{1,14}(\.\d{1,4})?$/;
const asString = ({ value }: { value: unknown }) =>
  typeof value === 'number' ? String(value) : value === '' ? null : value;
const emptyToNull = ({ value }: { value: unknown }) =>
  value === '' ? null : value;

export class ImportListingFieldsDto {
  @ApiPropertyOptional({ description: 'Product / material (GradeCategory id)' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  gradeId?: string | null;

  @ApiPropertyOptional({
    description:
      'Used when the grade is not in the master list (Admin can disable).',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(120)
  customGradeName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  brandId?: string | null;

  @ApiPropertyOptional({ description: 'Country (Location type COUNTRY) id' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  originCountryId?: string | null;

  @ApiPropertyOptional({
    example: '500',
    description: 'BUY: required quantity. SELL: available quantity.',
  })
  @IsOptional()
  @Transform(asString)
  @Matches(QTY, { message: 'quantity must be a decimal with up to 3 places' })
  quantity?: string | null;

  @ApiPropertyOptional({ enum: ImportQuantityUnit })
  @IsOptional()
  @IsEnum(ImportQuantityUnit)
  quantityUnit?: ImportQuantityUnit;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  packagingId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  application?: string | null;

  @ApiPropertyOptional({ example: '39011010' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(20)
  hsCode?: string | null;

  @ApiPropertyOptional({ example: '9002-88-4' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(20)
  casNumber?: string | null;

  @ApiPropertyOptional({
    example: '1050.00',
    description: 'BUY: target price. SELL: offer price.',
  })
  @IsOptional()
  @Transform(asString)
  @Matches(PRICE, { message: 'price must be a decimal with up to 4 places' })
  price?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  currencyId?: string | null;

  @ApiPropertyOptional({ enum: ImportQuantityUnit })
  @IsOptional()
  @IsEnum(ImportQuantityUnit)
  priceUnit?: ImportQuantityUnit;

  @ApiPropertyOptional({ enum: ImportPriceType })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEnum(ImportPriceType)
  priceType?: ImportPriceType | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  incotermId?: string | null;

  @ApiPropertyOptional({
    description:
      'Port the price basis refers to (e.g. FOB Shanghai, CIF Mundra)',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  priceBasisPortId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(160)
  priceBasisLocation?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  paymentTermId?: string | null;

  @ApiPropertyOptional({ enum: ImportGstTreatment })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEnum(ImportGstTreatment)
  gstTreatment?: ImportGstTreatment | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  polId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  podId?: string | null;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'Earliest shipment date',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsDateString({ strict: true })
  esd?: string | null;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Latest shipment date',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsDateString({ strict: true })
  lsd?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  transitMinDays?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  transitMaxDays?: number | null;

  @ApiPropertyOptional({ enum: ImportShipmentPermission })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEnum(ImportShipmentPermission)
  partialShipment?: ImportShipmentPermission | null;

  @ApiPropertyOptional({ enum: ImportShipmentPermission })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEnum(ImportShipmentPermission)
  transshipment?: ImportShipmentPermission | null;

  @ApiPropertyOptional({ enum: ImportShipmentType })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEnum(ImportShipmentType)
  shipmentType?: ImportShipmentType | null;

  @ApiPropertyOptional({ enum: ImportContainerSize })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEnum(ImportContainerSize)
  containerSize?: ImportContainerSize | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  containerCount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(5000)
  specification?: string | null;

  @ApiPropertyOptional({ enum: ImportInspectionType })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEnum(ImportInspectionType)
  inspectionType?: ImportInspectionType | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID('all', { each: true })
  documentRequirementIds?: string[];

  // BUY only
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(asString)
  @Matches(QTY)
  acceptableQuantityMin?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(asString)
  @Matches(QTY)
  acceptableQuantityMax?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsDateString({ strict: true })
  requiredDeliveryDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(3000)
  specialRequirements?: string | null;

  // SELL only
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(asString)
  @Matches(QTY)
  moq?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(asString)
  @Matches(QTY)
  maximumQuantity?: string | null;

  @ApiPropertyOptional({ enum: ImportReadyStockType })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEnum(ImportReadyStockType)
  readyStockType?: ImportReadyStockType | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(3000)
  remarks?: string | null;

  @ApiPropertyOptional({ description: 'Defaults to publish time.' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsDateString()
  validFrom?: string | null;

  @ApiPropertyOptional({
    description: 'Expiry instant (server time is authoritative).',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsDateString()
  validUntil?: string | null;

  @ApiPropertyOptional({
    description: 'Original free text for future AI/WhatsApp intake.',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(10000)
  rawInput?: string | null;
}

export class CreateImportListingDto extends ImportListingFieldsDto {
  @ApiPropertyOptional({
    enum: ['WEB', 'MOBILE'],
    description: 'Client channel; defaults to WEB.',
  })
  @IsOptional()
  @IsIn(['WEB', 'MOBILE'])
  source?: 'WEB' | 'MOBILE';
}

export class UpdateImportListingDto extends ImportListingFieldsDto {
  @ApiPropertyOptional({
    description:
      'Optimistic-lock version from the last read; stale saves are rejected.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class CancelImportListingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListImportListingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'market'] })
  @IsOptional()
  @IsIn(['mine', 'market'])
  scope?: 'mine' | 'market';

  @ApiPropertyOptional({ enum: ImportListingStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsEnum(ImportListingStatus, { each: true })
  status?: ImportListingStatus[];

  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() gradeId?: string;
  @IsOptional() @IsUUID() brandId?: string;
  @IsOptional() @IsUUID() originCountryId?: string;
  @IsOptional() @IsString() @MaxLength(3) currencyCode?: string;
  @IsOptional() @IsUUID() incotermId?: string;
  @IsOptional() @IsUUID() polId?: string;
  @IsOptional() @IsUUID() podId?: string;
  @IsOptional() @IsUUID() paymentTermId?: string;
  @IsOptional()
  @IsEnum(ImportInspectionType)
  inspectionType?: ImportInspectionType;
  @IsOptional()
  @IsEnum(ImportReadyStockType)
  readyStockType?: ImportReadyStockType;
  @IsOptional() @IsEnum(ImportShipmentType) shipmentType?: ImportShipmentType;

  @IsOptional() @Matches(PRICE) priceMin?: string;
  @IsOptional() @Matches(PRICE) priceMax?: string;
  @IsOptional() @Matches(QTY) quantityMin?: string;
  @IsOptional() @Matches(QTY) quantityMax?: string;

  @ApiPropertyOptional({ description: 'Shipment window overlaps this range' })
  @IsOptional()
  @IsDateString({ strict: true })
  shipmentFrom?: string;
  @IsOptional() @IsDateString({ strict: true }) shipmentTo?: string;

  @IsOptional() @IsDateString() createdFrom?: string;
  @IsOptional() @IsDateString() createdTo?: string;

  @ApiPropertyOptional({
    enum: [
      'createdAt',
      'validUntil',
      'price',
      'quantity',
      'esd',
      'publishedAt',
    ],
  })
  @IsOptional()
  @IsIn(['createdAt', 'validUntil', 'price', 'quantity', 'esd', 'publishedAt'])
  override sortBy?: string = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  override sortOrder?: 'asc' | 'desc' = 'desc';
}
