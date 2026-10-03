import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  MaxLength,
  Min,
} from 'class-validator';
import {
  ImportShipmentMode,
  ImportShipmentStatus,
} from '../../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../../master-data/common/pagination.js';

const QTY = /^\d{1,15}(\.\d{1,3})?$/;
const asString = ({ value }: { value: unknown }) =>
  typeof value === 'number' ? String(value) : value;
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

/** Carrier and routing details the seller (or Admin) maintains. */
class ImportShipmentDetailsDto {
  @ApiPropertyOptional({ enum: ImportShipmentMode })
  @IsOptional()
  @IsEnum(ImportShipmentMode)
  mode?: ImportShipmentMode;

  @ApiPropertyOptional({ example: 'Maersk' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(120)
  carrierName?: string | null;

  @ApiPropertyOptional({ description: 'B/L, AWB or LR number' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(80)
  trackingNumber?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(120)
  vesselName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  voyageNumber?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  containerNumbers?: string[];

  @ApiPropertyOptional({ description: 'Defaults to the deal port of loading' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(160)
  originLocation?: string | null;

  @ApiPropertyOptional({
    description: 'Defaults to the deal port of discharge',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(160)
  destinationLocation?: string | null;

  @ApiPropertyOptional({ description: 'Estimated departure (ISO 8601)' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsDateString()
  etd?: string | null;

  @ApiPropertyOptional({
    description: 'Estimated arrival (ISO 8601). Leave empty when unknown.',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsDateString()
  eta?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  remarks?: string | null;
}

export class CreateImportShipmentDto extends ImportShipmentDetailsDto {
  @ApiProperty({
    description: 'Quantity in the deal unit; cannot exceed what is unshipped.',
  })
  @Transform(asString)
  @Matches(QTY)
  quantity!: string;
}

export class UpdateImportShipmentDto extends ImportShipmentDetailsDto {
  @ApiPropertyOptional({ description: 'Optimistic-lock version' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

/**
 * A tracking update. Omitting `status` (or repeating the current one) records
 * a location/note without changing the shipment status.
 */
export class AddImportShipmentEventDto {
  @ApiPropertyOptional({ enum: ImportShipmentStatus })
  @IsOptional()
  @IsEnum(ImportShipmentStatus)
  status?: ImportShipmentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(160)
  location?: string | null;

  @ApiPropertyOptional({ description: 'Required when status is EXCEPTION' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({
    description: 'When it happened (defaults to now; cannot be in the future)',
  })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

export class ListImportShipmentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ImportShipmentStatus)
  status?: ImportShipmentStatus;

  @IsOptional() @IsUUID() dealId?: string;

  @IsOptional()
  @IsIn(['buyer', 'seller'])
  as?: 'buyer' | 'seller';
}

export class AdminImportShipmentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ImportShipmentStatus)
  status?: ImportShipmentStatus;

  @IsOptional() @IsUUID() dealId?: string;
  @IsOptional() @IsUUID() buyerOrgId?: string;
  @IsOptional() @IsUUID() sellerOrgId?: string;
  @IsOptional() @IsEnum(ImportShipmentMode) mode?: ImportShipmentMode;
  @IsOptional() @IsDateString() createdFrom?: string;
  @IsOptional() @IsDateString() createdTo?: string;

  @ApiPropertyOptional({ description: 'Only shipments in EXCEPTION status' })
  @IsOptional()
  @IsIn(['true', 'false'])
  exceptionsOnly?: 'true' | 'false';
}
