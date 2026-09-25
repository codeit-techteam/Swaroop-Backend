import { Injectable } from '@nestjs/common';
import {
  DocumentStatus,
  EntityOwnerType,
} from '../../../generated/prisma/client.js';
import { DocumentsCoreService } from '../../documents/services/documents-core.service.js';
import { SellerAuditService } from '../common/seller-audit.service.js';
import { SellerContextService } from '../common/seller-context.service.js';
import type {
  DocumentQueryDto,
  RegisterDocumentDto,
  ReplaceDocumentDto,
  UploadDocumentDto,
} from './documents.dto.js';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly sellerContext: SellerContextService,
    private readonly audit: SellerAuditService,
    private readonly documents: DocumentsCoreService,
  ) {}

  private async ownership(userId: string) {
    const ctx = await this.sellerContext.requireSeller(userId);
    return {
      ctx,
      filter: {
        ownerType: EntityOwnerType.SELLER,
        ownerId: ctx.sellerProfileId,
        organizationId: ctx.organizationId,
      },
    };
  }

  async list(userId: string, query: DocumentQueryDto) {
    const { ctx } = await this.ownership(userId);
    const result = await this.documents.list({
      page: query.page,
      limit: query.limit,
      category: query.category,
      status: query.status,
      search: query.search,
      organizationId: ctx.organizationId,
      ownerType: EntityOwnerType.SELLER,
      ownerId: ctx.sellerProfileId,
    });

    // Hide incomplete onboarding uploads that never confirmed the R2 object.
    const items = result.items.filter((item) => {
      const meta =
        item.metadata &&
        typeof item.metadata === 'object' &&
        !Array.isArray(item.metadata)
          ? (item.metadata as Record<string, unknown>)
          : null;
      if (!meta || meta.purpose !== 'SELLER_ONBOARDING') return true;
      return meta.r2Confirmed === true;
    });

    return {
      items,
      meta: {
        ...result.meta,
        total: items.length,
      },
    };
  }

  async upload(userId: string, dto: UploadDocumentDto) {
    const { ctx } = await this.ownership(userId);
    const result = await this.documents.create({
      organizationId: ctx.organizationId,
      uploadedById: userId,
      ownerType: EntityOwnerType.SELLER,
      ownerId: ctx.sellerProfileId,
      sellerProfileId: ctx.sellerProfileId,
      category: dto.category,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      fileSizeBytes: dto.fileSizeBytes,
      fileType: dto.fileType,
      metadata: dto.metadata,
      status: DocumentStatus.UPLOADED,
    });

    await this.audit.log({
      action: 'DOCUMENT_UPLOADED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: result.id,
      metadata: { category: dto.category, fileName: dto.fileName },
    });

    return result;
  }

  async register(userId: string, dto: RegisterDocumentDto) {
    const { ctx } = await this.ownership(userId);
    return this.documents.create({
      organizationId: ctx.organizationId,
      uploadedById: userId,
      ownerType: EntityOwnerType.SELLER,
      ownerId: ctx.sellerProfileId,
      sellerProfileId: ctx.sellerProfileId,
      category: dto.category,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      fileSizeBytes: dto.fileSizeBytes,
      fileType: dto.fileType,
      metadata: dto.metadata,
      storageKey: dto.storageKey,
      status: dto.status ?? DocumentStatus.UNDER_REVIEW,
    });
  }

  async get(userId: string, id: string) {
    const { filter } = await this.ownership(userId);
    return this.documents.getById(id, filter);
  }

  async submitForReview(userId: string, id: string) {
    const { ctx, filter } = await this.ownership(userId);
    const result = await this.documents.submitForReview(id, filter);
    await this.audit.log({
      action: 'DOCUMENT_SUBMITTED_FOR_REVIEW',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: id,
      metadata: { status: result.status },
    });
    return result;
  }

  async replace(userId: string, id: string, dto: ReplaceDocumentDto) {
    const { ctx, filter } = await this.ownership(userId);
    const result = await this.documents.replace(
      id,
      {
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        fileSizeBytes: dto.fileSizeBytes,
        metadata: {
          ...(dto.metadata ?? {}),
          purpose:
            (dto.metadata as Record<string, unknown> | undefined)?.purpose ??
            'SELLER_PANEL',
          awaitingAdminReview: true,
        },
        storageKey: dto.storageKey,
      },
      filter,
    );

    await this.audit.log({
      action: 'DOCUMENT_REPLACED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: id,
      metadata: { version: result.version, status: result.status },
    });

    return result;
  }

  async remove(userId: string, id: string) {
    const { ctx, filter } = await this.ownership(userId);
    const result = await this.documents.softDelete(id, filter);
    await this.audit.log({
      action: 'DOCUMENT_DELETED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: id,
    });
    return result;
  }

  async download(userId: string, id: string) {
    const { filter } = await this.ownership(userId);
    return this.documents.download(id, filter);
  }

  async preview(userId: string, id: string) {
    return this.download(userId, id);
  }

  async uploadUrl(userId: string, id: string) {
    const { filter } = await this.ownership(userId);
    return this.documents.getUploadUrl(id, filter);
  }

  async versions(userId: string, id: string) {
    const { filter } = await this.ownership(userId);
    return this.documents.versions(id, filter);
  }
}
