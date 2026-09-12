import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MasterStatus } from '../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../common/pagination.js';

export class CreateApplicationDto {
  @ApiProperty({ example: 'BLOW_MOULDING' })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  code!: string;

  @ApiProperty({ example: 'Blow Moulding' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: MasterStatus, default: MasterStatus.ACTIVE })
  @IsOptional()
  @IsEnum(MasterStatus)
  status?: MasterStatus;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateApplicationDto extends PartialType(CreateApplicationDto) {}

export class ApplicationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MasterStatus })
  @IsOptional()
  @IsEnum(MasterStatus)
  status?: MasterStatus;
}
