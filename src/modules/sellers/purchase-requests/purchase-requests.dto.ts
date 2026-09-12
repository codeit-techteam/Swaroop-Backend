import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CurrencyCode,
  PaymentMethod,
  PurchaseRequestResponseType,
  PurchaseRequestStatus,
} from '../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';

export class PurchaseRequestQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PurchaseRequestStatus })
  @IsOptional()
  @IsEnum(PurchaseRequestStatus)
  status?: PurchaseRequestStatus;
}

export class RespondPurchaseRequestDto {
  @ApiProperty({ enum: PurchaseRequestResponseType })
  @IsEnum(PurchaseRequestResponseType)
  type!: PurchaseRequestResponseType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional({
    description: 'Required for REJECT',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  rejectionReason?: string;

  @ApiPropertyOptional({
    description: 'Required for COUNTER_OFFER',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  counterPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  counterQuantity?: number;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class AcceptPurchaseRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class RejectPurchaseRequestDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  rejectionReason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}

export class CounterOfferPurchaseRequestDto {
  @ApiPropertyOptional({
    description: 'Preferred field name; alias of unitPrice',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  counterPrice?: number;

  @ApiPropertyOptional({ description: 'Alias for counterPrice' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  counterQuantity?: number;

  @ApiPropertyOptional({ description: 'Alias for counterQuantity' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
