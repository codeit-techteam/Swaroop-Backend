import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSellerProfileDto {
  @ApiPropertyOptional({ example: 'MANUFACTURER' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sellerType?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class SellerProfileQueryDto {
  @ApiPropertyOptional({
    description: 'Required for ADMIN/SUPER_ADMIN review of another seller',
  })
  @IsOptional()
  @IsString()
  sellerProfileId?: string;
}
