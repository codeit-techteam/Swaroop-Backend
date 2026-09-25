import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PaymentRail,
  PaymentStatus,
  SettlementStatus,
} from '../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';

export class CreatePaymentDto {
  @ApiProperty()
  @IsUUID()
  purchaseOrderId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  paymentScheduleId?: string;

  @ApiProperty({ example: 15000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiProperty({ enum: PaymentRail })
  @IsEnum(PaymentRail)
  rail!: PaymentRail;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class SubmitUtrDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  utrNumber!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;
}

export class AdminPaymentActionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class FinanceListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;
}

export class SettlementListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SettlementStatus })
  @IsOptional()
  @IsEnum(SettlementStatus)
  status?: SettlementStatus;

  @ApiPropertyOptional({
    enum: ['createdAt', 'settlementDate', 'grossAmount', 'netAmount', 'status'],
  })
  @IsOptional()
  @IsIn(['createdAt', 'settlementDate', 'grossAmount', 'netAmount', 'status'])
  sortBy?: 'createdAt' | 'settlementDate' | 'grossAmount' | 'netAmount' | 'status' =
    'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  override sortOrder?: 'asc' | 'desc' = 'desc';
}
