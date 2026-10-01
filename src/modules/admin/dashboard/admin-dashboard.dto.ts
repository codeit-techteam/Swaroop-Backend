import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class AdminDashboardQueryDto {
  @ApiPropertyOptional({
    description:
      'When set, flow metrics (orders, purchase requests, payments, import, logistics) count records created in this window. Snapshot metrics such as active customers stay current.',
    minimum: 1,
    maximum: 365,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}
