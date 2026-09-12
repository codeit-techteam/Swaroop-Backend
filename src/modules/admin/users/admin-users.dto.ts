import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import {
  AdminListQueryDto,
  AdminUserStatusFilter,
} from '../common/admin-query.dto.js';

export class AdminUsersQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: RoleCode })
  @IsOptional()
  @IsEnum(RoleCode)
  role?: RoleCode;

  @ApiPropertyOptional({ enum: AdminUserStatusFilter })
  @IsOptional()
  @IsEnum(AdminUserStatusFilter)
  status?: AdminUserStatusFilter;
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: AdminUserStatusFilter })
  @IsEnum(AdminUserStatusFilter)
  status!: AdminUserStatusFilter;
}

export class UpdateUserRoleDto {
  @ApiProperty({ enum: RoleCode })
  @IsEnum(RoleCode)
  role!: RoleCode;

  @ApiPropertyOptional({
    description: 'Optional organization scope for the role assignment',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  organizationId?: string;
}
