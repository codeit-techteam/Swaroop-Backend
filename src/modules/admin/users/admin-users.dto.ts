import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import {
  AdminListQueryDto,
  AdminUserStatusFilter,
} from '../common/admin-query.dto.js';

export enum AdminDirectoryStatusFilter {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
  BLOCKED = 'BLOCKED',
  PENDING = 'PENDING',
  INVITED = 'INVITED',
  REVOKED = 'REVOKED',
}

export class AdminUsersQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: RoleCode })
  @IsOptional()
  @IsEnum(RoleCode)
  role?: RoleCode;

  @ApiPropertyOptional({ enum: AdminDirectoryStatusFilter })
  @IsOptional()
  @IsEnum(AdminDirectoryStatusFilter)
  status?: AdminDirectoryStatusFilter;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sellerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastLoginFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastLoginTo?: string;
}

export class CreateSellerManagerDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '9000000000' })
  @IsString()
  @MinLength(10)
  @MaxLength(16)
  phone!: string;

  @ApiProperty()
  @IsUUID()
  sellerId!: string;

  @ApiProperty({ enum: [RoleCode.SELLER_MANAGER] })
  @IsIn([RoleCode.SELLER_MANAGER])
  role!: RoleCode.SELLER_MANAGER;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  permissions!: string[];

  @ApiPropertyOptional({ enum: ['INVITATION', 'TEMPORARY_PASSWORD'] })
  @IsOptional()
  @IsIn(['INVITATION', 'TEMPORARY_PASSWORD'])
  accessMethod?: 'INVITATION' | 'TEMPORARY_PASSWORD';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  temporaryPassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ example: 'Operations Manager' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;
}

export class UpdateManagerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(16)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sellerId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  permissions?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;
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
