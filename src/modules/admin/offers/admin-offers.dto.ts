import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
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
