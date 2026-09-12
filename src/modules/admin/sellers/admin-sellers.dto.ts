import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { SellerStatus } from '../../../generated/prisma/client.js';
import {
  AdminListQueryDto,
  AdminReasonDto,
} from '../common/admin-query.dto.js';

export class AdminSellersQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: SellerStatus })
  @IsOptional()
  @IsEnum(SellerStatus)
  status?: SellerStatus;
}

export class AdminSellerActionDto extends AdminReasonDto {}
