import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { BulkLogisticsQuoteStatus } from '../../../generated/prisma/client.js';
import { AdminListQueryDto } from '../common/admin-query.dto.js';

export class AdminBulkLogisticsQuotesQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: BulkLogisticsQuoteStatus })
  @IsOptional()
  @IsEnum(BulkLogisticsQuoteStatus)
  status?: BulkLogisticsQuoteStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

export class AdminBulkLogisticsQuoteNotesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
