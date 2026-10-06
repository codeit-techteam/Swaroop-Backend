import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';

export class MarketplaceHomeQueryDto {
  @ApiPropertyOptional({ default: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  featuredLimit?: number = 8;

  @ApiPropertyOptional({ default: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  offersLimit?: number = 8;

  @ApiPropertyOptional({ default: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  gradesLimit?: number = 12;
}

export class MarketplaceListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  gradeId?: string;
}

export class MarketplaceGradeQueryDto extends MarketplaceListQueryDto {
  @ApiPropertyOptional({ description: 'Category code, e.g. HDPE or PP_CP' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

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

  @ApiPropertyOptional({ description: 'Only grades with a live offer' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' || value === '1' || value === true
      ? true
      : value === 'false' || value === '0' || value === false
        ? false
        : value,
  )
  @IsBoolean()
  hasOffers?: boolean;
}
