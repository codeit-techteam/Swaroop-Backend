import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ExpectedCartPriceDto } from '../cart/cart.dto.js';

export class CreateCheckoutQuoteDto {
  @ApiPropertyOptional({
    description:
      'Marketplace product id or code. Used for seller matching when offerId is omitted.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  productId?: string;

  @ApiPropertyOptional({
    description: 'Specific marketplace offer. If omitted, backend matches the best seller offer.',
  })
  @IsOptional()
  @IsUUID()
  offerId?: string;

  @ApiProperty({ example: 25 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @ApiPropertyOptional({
    example: 'ADVANCE',
    description:
      'ADVANCE | ON_LOADING | ON_DELIVERY | CREDIT | CREDIT_15 | CREDIT_30',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentOption?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  shippingAddressId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  billingAddressId?: string;
}

export class QuoteFromCartDto {
  @ApiPropertyOptional({
    example: 'ADVANCE',
    description:
      'ADVANCE | ON_LOADING | ON_DELIVERY | CREDIT | CREDIT_15 | CREDIT_30',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentOption?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  shippingAddressId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  billingAddressId?: string;

  @ApiPropertyOptional({ type: [ExpectedCartPriceDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpectedCartPriceDto)
  expectedPrices?: ExpectedCartPriceDto[];
}

export class PlaceQuotePurchaseRequestDto {
  @ApiProperty()
  @IsUUID()
  quoteId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  shippingAddressId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  billingAddressId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  destinationRegion?: string;
}
