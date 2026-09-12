import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import {
  DocumentCategory,
  DocumentStatus,
} from '../../../generated/prisma/client.js';
import {
  AdminListQueryDto,
  AdminReasonDto,
} from '../common/admin-query.dto.js';

export class AdminDocumentsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: DocumentStatus })
  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @ApiPropertyOptional({ enum: DocumentCategory })
  @IsOptional()
  @IsEnum(DocumentCategory)
  category?: DocumentCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class AdminDocumentActionDto extends AdminReasonDto {}
