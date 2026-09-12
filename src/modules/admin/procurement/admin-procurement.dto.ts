import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PurchaseRequestStatus } from '../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';

export class AdminProcurementPrQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PurchaseRequestStatus })
  @IsOptional()
  @IsEnum(PurchaseRequestStatus)
  status?: PurchaseRequestStatus;
}

export class AdminNoteDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  note!: string;
}

export class AdminCancelDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}
