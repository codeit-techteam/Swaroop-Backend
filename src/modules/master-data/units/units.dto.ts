import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MasterStatus } from '../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../common/pagination.js';

export class CreateUnitDto {
  @ApiProperty({ example: 'MT' })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  code!: string;

  @ApiProperty({ example: 'Metric Ton' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'MT' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  symbol?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: MasterStatus, default: MasterStatus.ACTIVE })
  @IsOptional()
  @IsEnum(MasterStatus)
  status?: MasterStatus;

  @ApiPropertyOptional({ default: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  decimalPrecision?: number;
}

export class UpdateUnitDto extends PartialType(CreateUnitDto) {}

export class UnitQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MasterStatus })
  @IsOptional()
  @IsEnum(MasterStatus)
  status?: MasterStatus;
}
