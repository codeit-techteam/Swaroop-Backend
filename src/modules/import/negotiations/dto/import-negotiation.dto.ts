import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  ImportDealStatus,
  ImportInspectionType,
  ImportNegotiationStatus,
} from '../../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../../master-data/common/pagination.js';

const QTY = /^\d{1,15}(\.\d{1,3})?$/;
const PRICE = /^\d{1,14}(\.\d{1,4})?$/;
const asString = ({ value }: { value: unknown }) =>
  typeof value === 'number' ? String(value) : value;

/**
 * Negotiable terms besides price/quantity. Currency, Incoterm and units stay
 * those of the listing so every round's price remains directly comparable.
 */
class NegotiationTermsBaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(asString)
  @Matches(QTY)
  moq?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  paymentTermId?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDateString({ strict: true })
  esd?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @IsDateString({ strict: true })
  lsd?: string;

  @ApiPropertyOptional({ enum: ImportInspectionType })
  @IsOptional()
  @IsEnum(ImportInspectionType)
  inspectionType?: ImportInspectionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  otherTerms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CounterOfferDto extends NegotiationTermsBaseDto {
  @ApiPropertyOptional({ example: '1040.00' })
  @IsOptional()
  @Transform(asString)
  @Matches(PRICE, { message: 'price must be a decimal with up to 4 places' })
  price?: string;

  @ApiPropertyOptional({ example: '250' })
  @IsOptional()
  @Transform(asString)
  @Matches(QTY, { message: 'quantity must be a decimal with up to 3 places' })
  quantity?: string;
}

export class OpenNegotiationDto extends NegotiationTermsBaseDto {
  @ApiProperty({ description: 'The counterparty listing being responded to.' })
  @IsUUID()
  listingId!: string;

  @ApiPropertyOptional({
    description: "Caller's own opposite-side listing (links the match).",
  })
  @IsOptional()
  @IsUUID()
  counterListingId?: string;

  @ApiProperty({ example: '1040.00' })
  @Transform(asString)
  @Matches(PRICE, { message: 'price must be a decimal with up to 4 places' })
  price!: string;

  @ApiProperty({ example: '250' })
  @Transform(asString)
  @Matches(QTY, { message: 'quantity must be a decimal with up to 3 places' })
  quantity!: string;
}

export class NegotiationNoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ListNegotiationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ImportNegotiationStatus)
  status?: ImportNegotiationStatus;

  @IsOptional()
  @IsUUID()
  listingId?: string;

  @ApiPropertyOptional({
    enum: ['buyer', 'seller'],
    description: 'When the user trades on both sides.',
  })
  @IsOptional()
  @IsIn(['buyer', 'seller'])
  as?: 'buyer' | 'seller';
}

export class ListDealsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ImportDealStatus)
  status?: ImportDealStatus;

  @IsOptional()
  @IsIn(['buyer', 'seller'])
  as?: 'buyer' | 'seller';
}
