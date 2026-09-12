import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ProductMediaType,
  ProductStatus,
} from '../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';

export class ProductMediaInputDto {
  @ApiProperty({ enum: ProductMediaType })
  @IsEnum(ProductMediaType)
  type!: ProductMediaType;

  @ApiProperty({ example: 'products/abc/image-1.jpg' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  storageKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  mimeType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fileSizeBytes?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateProductDto {
  @ApiProperty()
  @IsUUID()
  gradeId!: string;

  @ApiProperty({ example: 'HDPE-FILM-01' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @ApiProperty({ example: 'HDPE Film Grade Resin' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  manufacturer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  technicalSpecs?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  mfi?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  density?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  packaging?: string;

  @ApiPropertyOptional({ default: 'MT' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  countryOfOrigin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplyOrigin?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [ProductMediaInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductMediaInputDto)
  media?: ProductMediaInputDto[];
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class ProductQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  gradeId?: string;
}

export class UpdateProductStatusDto {
  @ApiProperty({ enum: ProductStatus })
  @IsEnum(ProductStatus)
  status!: ProductStatus;
}

export class CreateProductMediaDto extends ProductMediaInputDto {}
