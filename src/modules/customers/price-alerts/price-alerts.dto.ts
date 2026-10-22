import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { CurrencyCode } from '../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';

const PRICE = /^\d{1,14}(\.\d{1,4})?$/;

export class CreatePriceAlertDto {
  @ApiProperty()
  @IsUUID()
  gradeId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty({ example: '148000.00' })
  @IsString()
  @Matches(PRICE)
  targetPrice!: string;

  @ApiPropertyOptional({ enum: CurrencyCode, default: CurrencyCode.INR })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ example: 'MT', default: 'MT' })
  @IsOptional()
  @IsIn(['MT', 'KG'])
  unit?: 'MT' | 'KG';

  @ApiPropertyOptional({ enum: ['BELOW', 'ABOVE'], default: 'BELOW' })
  @IsOptional()
  @IsIn(['BELOW', 'ABOVE'])
  direction?: 'BELOW' | 'ABOVE';

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdatePriceAlertDto {
  @ApiPropertyOptional({ example: '148000.00' })
  @IsOptional()
  @IsString()
  @Matches(PRICE)
  targetPrice?: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ enum: ['MT', 'KG'] })
  @IsOptional()
  @IsIn(['MT', 'KG'])
  unit?: 'MT' | 'KG';

  @ApiPropertyOptional({ enum: ['BELOW', 'ABOVE'] })
  @IsOptional()
  @IsIn(['BELOW', 'ABOVE'])
  direction?: 'BELOW' | 'ABOVE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListPriceAlertsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  gradeId?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  enabled?: 'true' | 'false';}
