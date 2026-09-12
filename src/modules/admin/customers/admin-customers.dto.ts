import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CustomerStatus } from '../../../generated/prisma/client.js';
import {
  AdminListQueryDto,
  AdminReasonDto,
} from '../common/admin-query.dto.js';

export class AdminCustomersQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: CustomerStatus })
  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;
}

export class AdminCustomerActionDto extends AdminReasonDto {}
