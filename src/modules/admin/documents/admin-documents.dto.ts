import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  DocumentCategory,
  DocumentStatus,
  EntityOwnerType,
} from '../../../generated/prisma/client.js';
import {
  AdminListQueryDto,
  AdminReasonDto,
} from '../common/admin-query.dto.js';

export const ADMIN_DOCUMENT_PURPOSES = [
  'SELLER_ONBOARDING',
  'SELLER_PANEL',
  'CUSTOMER_KYC',
] as const;

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

  @ApiPropertyOptional({ enum: EntityOwnerType })
  @IsOptional()
  @IsEnum(EntityOwnerType)
  ownerType?: EntityOwnerType;

  @ApiPropertyOptional({
    description: 'Seller profile id (owner of seller documents)',
  })
  @IsOptional()
  @IsUUID()
  sellerProfileId?: string;

  @ApiPropertyOptional({ enum: ADMIN_DOCUMENT_PURPOSES })
  @IsOptional()
  @IsIn(ADMIN_DOCUMENT_PURPOSES)
  purpose?: (typeof ADMIN_DOCUMENT_PURPOSES)[number];
}

export class AdminDocumentDownloadQueryDto {
  @ApiPropertyOptional({
    enum: ['inline', 'attachment'],
    description: 'inline = preview in browser, attachment = force download',
  })
  @IsOptional()
  @IsIn(['inline', 'attachment'])
  disposition?: 'inline' | 'attachment';
}

export class AdminDocumentActionDto extends AdminReasonDto {}
