import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class AddCartItemDto {
  @ApiProperty()
  @IsUUID()
  offerId!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @ApiPropertyOptional({
    description:
      'ADVANCE | BEFORE_DISPATCH | ON_LOADING | ON_DELIVERY | CREDIT_15 | CREDIT_30 | CREDIT (→ CREDIT_30) | PARTIAL_ADVANCE | PARTIAL_PAYMENT | MILESTONE_PAYMENT',
  })
  @IsOptional()
  @IsString()
  paymentMethod?: string;
}

export class UpdateCartItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional({
    description: 'If provided and differs from resolved price → PRICE_CHANGED',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedUnitPrice?: number;
}

export class ExpectedCartPriceDto {
  @ApiProperty()
  @IsUUID()
  cartItemId!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number;
}

export class ValidateCartDto {
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
