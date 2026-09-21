import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CmsBannerPlacement,
  CmsBannerPlatform,
  CmsBannerStatus,
} from '../../generated/prisma/client.js';
import { PaginationQueryDto } from '../master-data/common/pagination.js';

export class CreateCmsBannerDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  subtitle?: string;

  @ApiPropertyOptional({ enum: CmsBannerPlacement })
  @IsOptional()
  @IsEnum(CmsBannerPlacement)
  placement?: CmsBannerPlacement;

  @ApiPropertyOptional({ enum: CmsBannerPlatform })
  @IsOptional()
  @IsEnum(CmsBannerPlatform)
  platform?: CmsBannerPlatform;

  @ApiPropertyOptional({ enum: CmsBannerStatus })
  @IsOptional()
  @IsEnum(CmsBannerStatus)
  status?: CmsBannerStatus;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endAt?: string;

  @ApiPropertyOptional({
    description: 'Optional object storage key. R2 is not required.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  mediaKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  targetRoute?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateCmsBannerDto extends PartialType(CreateCmsBannerDto) {}

export class CmsBannerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CmsBannerStatus })
  @IsOptional()
  @IsEnum(CmsBannerStatus)
  status?: CmsBannerStatus;

  @ApiPropertyOptional({ enum: CmsBannerPlacement })
  @IsOptional()
  @IsEnum(CmsBannerPlacement)
  placement?: CmsBannerPlacement;

  @ApiPropertyOptional({ enum: CmsBannerPlatform })
  @IsOptional()
  @IsEnum(CmsBannerPlatform)
  platform?: CmsBannerPlatform;
}
