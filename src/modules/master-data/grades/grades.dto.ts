import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
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

/** Query strings arrive as "true"/"false"; Boolean("false") would be true. */
const toBoolean = ({ value }: { value: unknown }) => {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
};

export class GradeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: GradeStatus })
  @IsOptional()
  @IsEnum(GradeStatus)
  status?: GradeStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Category code, e.g. HDPE or PP_CP' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  subcategoryId?: string;

  @ApiPropertyOptional({ description: 'Source.One Grade Group (exact)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  gradeGroup?: string;

  @ApiPropertyOptional({
    description: 'Manufacturer (exact, case-insensitive)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  manufacturer?: string;

  @ApiPropertyOptional({ example: 'SOURCE_ONE' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  inTodaysDelhiPriceList?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  customerVisible?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  sellerVisible?: boolean;
}

export class GradeFacetQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @ApiPropertyOptional({ description: 'Filter the manufacturer list' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
