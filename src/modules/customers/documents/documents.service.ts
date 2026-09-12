import { Injectable } from '@nestjs/common';
import {
  DocumentStatus,
  EntityOwnerType,
} from '../../../generated/prisma/client.js';
import { DocumentsCoreService } from '../../documents/services/documents-core.service.js';
import { CustomerAuditService } from '../common/customer-audit.service.js';
import { CustomerContextService } from '../common/customer-context.service.js';
import type {
  CreateCustomerDocumentDto,
  CustomerDocumentQueryDto,
  ReplaceCustomerDocumentDto,
} from './documents.dto.js';

@Injectable()
export class CustomerDocumentsService {
  constructor(
    private readonly customerContext: CustomerContextService,
    private readonly audit: CustomerAuditService,
    private readonly documents: DocumentsCoreService,
  ) {}

  private async ownership(userId: string) {
    const ctx = await this.customerContext.requireCustomer(userId);
    return {
      ctx,
      filter: {
        ownerType: EntityOwnerType.CUSTOMER,
        ownerId: ctx.customerProfileId,
        organizationId: ctx.organizationId,
      },
    };
  }

  async list(userId: string, query: CustomerDocumentQueryDto) {
    const { ctx } = await this.ownership(userId);
    return this.documents.list({
      page: query.page,
      limit: query.limit,
      category: query.category,
      status: query.status,
      search: query.search,
      organizationId: ctx.organizationId,
      ownerType: EntityOwnerType.CUSTOMER,
      ownerId: ctx.customerProfileId,
    });
  }

  async create(userId: string, dto: CreateCustomerDocumentDto) {
    const { ctx } = await this.ownership(userId);
    const result = await this.documents.create({
      organizationId: ctx.organizationId,
      uploadedById: userId,
      ownerType: EntityOwnerType.CUSTOMER,
      ownerId: ctx.customerProfileId,
      customerProfileId: ctx.customerProfileId,
      category: dto.category,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      fileSizeBytes: dto.fileSizeBytes,
      fileType: dto.fileType,
      metadata: dto.metadata,
      status: DocumentStatus.UPLOADED,
    });

    await this.audit.log({
      action: 'DOCUMENT_CREATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: result.id,
      metadata: { category: dto.category, fileName: dto.fileName },
    });

    return result;
  }

  async get(userId: string, id: string) {
    const { filter } = await this.ownership(userId);
    return this.documents.getById(id, filter);
  }

  async replace(userId: string, id: string, dto: ReplaceCustomerDocumentDto) {
    const { ctx, filter } = await this.ownership(userId);
    const result = await this.documents.replace(
      id,
      {
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        fileSizeBytes: dto.fileSizeBytes,
        metadata: dto.metadata,
      },
      filter,
    );

    await this.audit.log({
      action: 'DOCUMENT_REPLACED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: id,
      metadata: { version: result.version },
    });

    return result;
  }

  async download(userId: string, id: string) {
    const { filter } = await this.ownership(userId);
    return this.documents.download(id, filter);
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
