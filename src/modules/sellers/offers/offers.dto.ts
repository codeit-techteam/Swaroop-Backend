import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CurrencyCode,
  OfferStatus,
  PaymentMethod,
} from '../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';

export class OfferPriceTierInputDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minQty!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxQty?: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ enum: CurrencyCode, default: CurrencyCode.INR })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}

export class CreateOfferDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({
    description: 'Optional; gradeId is copied from the product when omitted',
  })
  @IsOptional()
  @IsUUID()
  gradeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  inventoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  moq?: number;

  @ApiPropertyOptional({ default: 'MT' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  unit?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  basePrice!: number;

  @ApiPropertyOptional({ enum: CurrencyCode, default: CurrencyCode.INR })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  pricingBasis?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  paymentTerms?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryTerms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ default: 'MARKETPLACE' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  visibility?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [OfferPriceTierInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OfferPriceTierInputDto)
  priceTiers?: OfferPriceTierInputDto[];
}

export class UpdateOfferDto extends PartialType(CreateOfferDto) {}

export class OfferQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OfferStatus })
  @IsOptional()
  @IsEnum(OfferStatus)
  status?: OfferStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  gradeId?: string;
}
