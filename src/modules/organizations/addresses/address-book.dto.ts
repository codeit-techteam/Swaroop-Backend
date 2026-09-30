import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AddressType } from '../../../generated/prisma/client.js';

export const INDIAN_PINCODE_REGEX = /^[1-9][0-9]{5}$/;

export const ADDRESS_SOURCES = [
  'AUTOCOMPLETE',
  'GPS',
  'MAP_PIN',
  'PINCODE',
  'MANUAL',
] as const;
export type AddressSource = (typeof ADDRESS_SOURCES)[number];

/** Sources that come from a resolved geo point and therefore must carry coordinates. */
export const GEO_ADDRESS_SOURCES: ReadonlySet<AddressSource> = new Set([
  'AUTOCOMPLETE',
  'GPS',
  'MAP_PIN',
]);

export class CreateAddressBookEntryDto {
  @ApiPropertyOptional({ enum: AddressType, default: AddressType.SHIPPING })
  @IsOptional()
  @IsEnum(AddressType)
  type?: AddressType;

  @ApiPropertyOptional({ example: 'Primary Warehouse' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiProperty({ example: 'Plot 12, MIDC Industrial Area' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  line1!: string;

  @ApiPropertyOptional({ example: 'Andheri East' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  line2?: string;

  @ApiProperty({ example: 'Mumbai' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city!: string;

  @ApiProperty({ example: 'Maharashtra' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  state!: string;

  @ApiPropertyOptional({ default: 'IN' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  country?: string;

  @ApiProperty({ example: '400093' })
  @IsString()
  @Matches(INDIAN_PINCODE_REGEX, {
    message: 'postalCode must be a valid 6-digit Indian pincode',
  })
  postalCode!: string;

  @ApiPropertyOptional({ example: 'Near JNPT feeder road' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  landmark?: string;

  @ApiPropertyOptional({ example: 'Andheri East' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  locality?: string;

  @ApiPropertyOptional({ example: 'Mumbai Suburban' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @ApiPropertyOptional({ example: 19.1136 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 72.8697 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({
    description: 'Google Place ID of the resolved location',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{10,300}$/, { message: 'placeId is invalid' })
  placeId?: string;

  @ApiPropertyOptional({
    example: 'Plot 12, MIDC, Andheri East, Mumbai 400093',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  formattedAddress?: string;

  @ApiPropertyOptional({ description: 'Device-reported GPS accuracy (metres)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  accuracyMeters?: number;

  @ApiPropertyOptional({ enum: ADDRESS_SOURCES, default: 'MANUAL' })
  @IsOptional()
  @IsIn(ADDRESS_SOURCES as unknown as string[])
  source?: AddressSource;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressBookEntryDto extends PartialType(
  CreateAddressBookEntryDto,
) {}
