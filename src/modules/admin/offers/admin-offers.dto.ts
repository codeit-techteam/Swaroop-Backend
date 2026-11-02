import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { OfferStatus } from '../../../generated/prisma/client.js';
import {
  AdminListQueryDto,
  AdminReasonDto,
} from '../common/admin-query.dto.js';

export class AdminOffersQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: OfferStatus })
  @IsOptional()
  @IsEnum(OfferStatus)
  status?: OfferStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class AdminOfferActionDto extends AdminReasonDto {}

/**
 * Admin correction of marketplace material price (Offer.basePrice, always ₹/MT).
 * Provide exactly one of pricePerMt or pricePerKg (1 MT = 1,000 kg).
 */
export class AdminUpdateOfferPriceDto {
  @ApiPropertyOptional({
    description: 'Material selling price in ₹ per metric ton',
    example: 98000,
  })
  @ValidateIf((o: AdminUpdateOfferPriceDto) => o.pricePerKg == null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  pricePerMt?: number;

  @ApiPropertyOptional({
    description: 'Material selling price in ₹ per kg (converted ×1000 to MT)',
    example: 98,
  })
  @ValidateIf((o: AdminUpdateOfferPriceDto) => o.pricePerMt == null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  pricePerKg?: number;

  @ApiProperty({
    description: 'Audit reason for the price correction',
    example: 'Corrected test ₹10/MT listing to market Delhi rate',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reason!: string;
}
