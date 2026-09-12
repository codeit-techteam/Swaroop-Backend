import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CurrencyCode,
  PaymentMethod,
} from '../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';

export class CreatePriceTierDto {
  @ApiProperty()
  @IsUUID()
  offerId!: string;

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

export class UpdatePriceTierDto extends PartialType(CreatePriceTierDto) {
  @ApiPropertyOptional({
    description: 'Reason recorded on PriceRevision when offer is ACTIVE',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  revisionReason?: string;

  @ApiPropertyOptional({
    description: 'When false, only create PriceRevision without updating tier',
  })
  @IsOptional()
  @IsBoolean()
  applyToTier?: boolean;
}

export class PricingQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  offerId?: string;
}

export class SetPriceTierActiveDto {
  @ApiProperty()
  @IsBoolean()
  active!: boolean;
}
