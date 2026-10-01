import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
import {
  MasterStatus,
  PaymentTermMethod,
  PaymentTermType,
} from '../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../common/pagination.js';

export class CreatePaymentTermDto {
  @ApiProperty({ example: 'NET_30' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @ApiProperty({ example: 'Net 30' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: PaymentTermType })
  @IsEnum(PaymentTermType)
  paymentType!: PaymentTermType;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  days?: number;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage?: number;

  @ApiPropertyOptional({ enum: MasterStatus })
  @IsOptional()
  @IsEnum(MasterStatus)
  status?: MasterStatus;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    enum: PaymentTermMethod,
    description: 'Instrument family (Import forms group by this)',
  })
  @IsOptional()
  @IsEnum(PaymentTermMethod)
  method?: PaymentTermMethod;

  @ApiPropertyOptional({
    type: [String],
    example: ['USD', 'EUR', 'CNY'],
    description: 'Empty = all currencies',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(/^[A-Z]{3}$/, { each: true })
  currencyCodes?: string[];

  @ApiPropertyOptional({
    description: 'Offer this term in Import BUY/SELL forms',
  })
  @IsOptional()
  @IsBoolean()
  importEnabled?: boolean;
}

export class UpdatePaymentTermDto extends PartialType(CreatePaymentTermDto) {}

export class PaymentTermQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MasterStatus })
  @IsOptional()
  @IsEnum(MasterStatus)
  status?: MasterStatus;

  @ApiPropertyOptional({ enum: PaymentTermType })
  @IsOptional()
  @IsEnum(PaymentTermType)
  paymentType?: PaymentTermType;

  @ApiPropertyOptional({ enum: ['all', 'import', 'domestic'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'import', 'domestic'])
  scope?: 'all' | 'import' | 'domestic';

  @ApiPropertyOptional({ enum: PaymentTermMethod })
  @IsOptional()
  @IsEnum(PaymentTermMethod)
  method?: PaymentTermMethod;
}
