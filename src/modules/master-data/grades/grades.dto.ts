import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { GradeStatus } from '../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../common/pagination.js';

export class CreateGradeDto {
  @ApiProperty({ example: 'HDPE_FILM' })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  code!: string;

  @ApiProperty({ example: 'HD Film' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'HDPE' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  subcategoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicationCodes?: string[];

  @ApiPropertyOptional({ enum: GradeStatus, default: GradeStatus.ACTIVE })
  @IsOptional()
  @IsEnum(GradeStatus)
  status?: GradeStatus;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  customerVisible?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  sellerVisible?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  hsnCode?: string;
}

export class UpdateGradeDto extends PartialType(CreateGradeDto) {}

export class UpdateGradeStatusDto {
  @ApiProperty({ enum: GradeStatus })
  @IsEnum(GradeStatus)
  status!: GradeStatus;
}

export class UpdateGradeVisibilityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  customerVisible?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sellerVisible?: boolean;
}

export class GradeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: GradeStatus })
  @IsOptional()
  @IsEnum(GradeStatus)
  status?: GradeStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  subcategoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  customerVisible?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  sellerVisible?: boolean;
}
