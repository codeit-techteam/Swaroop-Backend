import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentCategory,
  DocumentStatus,
  EntityOwnerType,
  Prisma,
  ProductStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { StorageService } from '../../../storage/storage.service.js';
import { DocumentsCoreService } from '../../documents/services/documents-core.service.js';
import {
  customerDocumentStatusLabel,
  customerDocumentTitle,
  isProductDocumentCategory,
  PRODUCT_DOCUMENT_MIME_TYPES,
  resolveProductDocumentCategory,
} from '../../documents/common/product-document.helpers.js';
import { assertFileSize } from '../../documents/common/document-validation.js';
import { SellerAuditService } from '../common/seller-audit.service.js';
import {
  SellerContext,
  SellerContextService,
} from '../common/seller-context.service.js';
import type {
  PatchProductDocumentDto,
  ReplaceProductDocumentDto,
  UploadProductDocumentDto,
} from './product-documents.dto.js';

@Injectable()
export class ProductDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerContext: SellerContextService,
    private readonly audit: SellerAuditService,
    private readonly documents: DocumentsCoreService,
    private readonly storage: StorageService,
  ) {}

  private async ctx(userId: string) {
    return this.sellerContext.requireSeller(userId);
  }

  private async assertOwnedProduct(ctx: SellerContext, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        gradeId: true,
        status: true,
        organizationId: true,
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private async assertOwnedOffer(
    ctx: SellerContext,
    offerId: string,
    productId?: string,
  ) {
    const offer = await this.prisma.offer.findFirst({
      where: {
        id: offerId,
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(productId ? { productId } : {}),
      },
      select: { id: true, productId: true, gradeId: true },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    return offer;
  }

  private assertProductMime(mimeType: string) {
    if (!(PRODUCT_DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType)) {
      throw new BadRequestException(
        `Unsupported mime type. Allowed: ${PRODUCT_DOCUMENT_MIME_TYPES.join(', ')}`,
      );
    }
  }

  private mapSellerDoc(doc: {
    id: string;
    category: DocumentCategory;
    fileName: string;
    originalFileName: string | null;
    mimeType: string | null;
    fileSizeBytes: bigint | null;
    status: DocumentStatus;
    version: number;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
    approvedAt: Date | null;
    rejectionReason: string | null;
  }) {
    const meta = (doc.metadata ?? {}) as Record<string, unknown>;
    return {
      id: doc.id,
      documentType: doc.category,
      title:
        (typeof meta.title === 'string' && meta.title) ||
        customerDocumentTitle(doc.category),
      description:
        typeof meta.description === 'string' ? meta.description : null,
      originalFileName: doc.originalFileName ?? doc.fileName,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes?.toString() ?? null,
      version: doc.version,
      status: doc.status,
      statusLabel: customerDocumentStatusLabel(doc.status),
      offerId: typeof meta.offerId === 'string' ? meta.offerId : null,
      gradeId: typeof meta.gradeId === 'string' ? meta.gradeId : null,
      customerVisible: meta.customerVisible !== false,
      uploadedAt: doc.createdAt,
      approvedAt: doc.approvedAt,
      rejectionReason: doc.rejectionReason,
      updatedAt: doc.updatedAt,
    };
  }

  async listForProduct(userId: string, productId: string) {
    const ctx = await this.ctx(userId);
    await this.assertOwnedProduct(ctx, productId);

    const items = await this.prisma.document.findMany({
      where: {
        deletedAt: null,
        ownerType: EntityOwnerType.PRODUCT,
        ownerId: productId,
        organizationId: ctx.organizationId,
        status: { not: DocumentStatus.ARCHIVED },
      },
      orderBy: [{ category: 'asc' }, { version: 'desc' }, { createdAt: 'desc' }],
    });

    return items.map((d) => this.mapSellerDoc(d));
  }

  async uploadForProduct(
    userId: string,
    productId: string,
    dto: UploadProductDocumentDto,
  ) {
    const ctx = await this.ctx(userId);
    const product = await this.assertOwnedProduct(ctx, productId);

    const category = resolveProductDocumentCategory(dto.documentType);
    if (!isProductDocumentCategory(category)) {
      throw new BadRequestException('INVALID_DOCUMENT_TYPE');
    }
    this.assertProductMime(dto.mimeType);
    assertFileSize(dto.fileSizeBytes, this.storage.getMaxDocumentSizeBytes());

    let offerId: string | undefined;
    if (dto.offerId) {
      const offer = await this.assertOwnedOffer(ctx, dto.offerId, productId);
      offerId = offer.id;
    }

    const title =
      dto.title?.trim() || customerDocumentTitle(category);
    const metadata: Record<string, unknown> = {
      title,
      description: dto.description?.trim() || null,
      gradeId: product.gradeId,
      customerVisible: true,
      scope: offerId ? 'OFFER' : 'PRODUCT',
      ...(offerId ? { offerId } : {}),
    };

    // Align with seller self-activate: product docs are customer-visible
    // once the parent product is ACTIVE (no separate admin gate).
    const status =
      product.status === ProductStatus.ACTIVE
        ? DocumentStatus.VERIFIED
        : DocumentStatus.UPLOADED;

    const result = await this.documents.create({
      organizationId: ctx.organizationId,
      uploadedById: userId,
      ownerType: EntityOwnerType.PRODUCT,
      ownerId: productId,
      productId,
      category,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      fileSizeBytes: dto.fileSizeBytes,
      fileType: dto.fileType,
      metadata,
      status,
      requireUploadUrl: false,
    });

    await this.audit.log({
      action: 'DOCUMENT_UPLOADED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: result.id,
      metadata: {
        productId,
        offerId: offerId ?? null,
        category,
        title,
      },
    });

    const doc = await this.prisma.document.findUniqueOrThrow({
      where: { id: result.id },
    });

    return {
      ...this.mapSellerDoc(doc),
      uploadUrl: result.uploadUrl ?? null,
    };
  }

  async getForProduct(userId: string, productId: string, documentId: string) {
    const ctx = await this.ctx(userId);
    await this.assertOwnedProduct(ctx, productId);
    const doc = await this.requireProductDoc(ctx, productId, documentId);
    return this.mapSellerDoc(doc);
  }

  private async requireProductDoc(
    ctx: SellerContext,
    productId: string,
    documentId: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        deletedAt: null,
        ownerType: EntityOwnerType.PRODUCT,
        ownerId: productId,
        organizationId: ctx.organizationId,
      },
    });
    if (!doc) throw new NotFoundException('DOCUMENT_NOT_FOUND');
    return doc;
  }

  async patchForProduct(
    userId: string,
    productId: string,
    documentId: string,
    dto: PatchProductDocumentDto,
  ) {
    const ctx = await this.ctx(userId);
    await this.assertOwnedProduct(ctx, productId);
    const existing = await this.requireProductDoc(ctx, productId, documentId);
    const meta = {
      ...((existing.metadata ?? {}) as Record<string, unknown>),
    };
    if (dto.title !== undefined) meta.title = dto.title.trim();
    if (dto.description !== undefined) {
      meta.description = dto.description?.trim() || null;
    }
    if (dto.customerVisible !== undefined) {
      meta.customerVisible = dto.customerVisible;
    }

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: { metadata: meta as Prisma.InputJsonValue },
    });

    await this.audit.log({
      action: 'PRODUCT_UPDATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: documentId,
      metadata: { productId, patch: true },
    });

    return this.mapSellerDoc(updated);
  }

  async replaceForProduct(
    userId: string,
    productId: string,
    documentId: string,
    dto: ReplaceProductDocumentDto,
  ) {
    const ctx = await this.ctx(userId);
    await this.assertOwnedProduct(ctx, productId);
    const existing = await this.requireProductDoc(ctx, productId, documentId);
    this.assertProductMime(dto.mimeType);
    assertFileSize(dto.fileSizeBytes, this.storage.getMaxDocumentSizeBytes());

    const meta = {
      ...((existing.metadata ?? {}) as Record<string, unknown>),
    };
    if (dto.title?.trim()) meta.title = dto.title.trim();
    if (dto.description !== undefined) {
      meta.description = dto.description?.trim() || null;
    }

    const result = await this.documents.replace(
      documentId,
      {
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        fileSizeBytes: dto.fileSizeBytes,
        metadata: meta,
        markPreviousReplaced: true,
      },
      {
        ownerType: EntityOwnerType.PRODUCT,
        ownerId: productId,
        organizationId: ctx.organizationId,
      },
    );

    // Re-verify after replace when product is already live
    const product = await this.assertOwnedProduct(ctx, productId);
    if (product.status === ProductStatus.ACTIVE) {
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.VERIFIED,
          approvedAt: new Date(),
          approvedById: userId,
        },
      });
    }

    await this.audit.log({
      action: 'DOCUMENT_REPLACED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: documentId,
      metadata: { productId, version: result.version },
    });

    const doc = await this.prisma.document.findUniqueOrThrow({
      where: { id: documentId },
    });

    return {
      ...this.mapSellerDoc(doc),
      uploadUrl: result.uploadUrl ?? null,
    };
  }

  async archiveForProduct(
    userId: string,
    productId: string,
    documentId: string,
  ) {
    const ctx = await this.ctx(userId);
    await this.assertOwnedProduct(ctx, productId);
    await this.requireProductDoc(ctx, productId, documentId);

    await this.documents.softDelete(documentId, {
      ownerType: EntityOwnerType.PRODUCT,
      ownerId: productId,
      organizationId: ctx.organizationId,
    });

    await this.audit.log({
      action: 'DOCUMENT_ARCHIVED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: documentId,
      metadata: { productId },
    });

    return { id: documentId, archived: true };
  }

  async downloadForProduct(
    userId: string,
    productId: string,
    documentId: string,
  ) {
    const ctx = await this.ctx(userId);
    await this.assertOwnedProduct(ctx, productId);
    return this.documents.download(documentId, {
      ownerType: EntityOwnerType.PRODUCT,
      ownerId: productId,
      organizationId: ctx.organizationId,
    });
  }

  async uploadUrlForProduct(
    userId: string,
    productId: string,
    documentId: string,
  ) {
    const ctx = await this.ctx(userId);
    await this.assertOwnedProduct(ctx, productId);
    return this.documents.getUploadUrl(documentId, {
      ownerType: EntityOwnerType.PRODUCT,
      ownerId: productId,
      organizationId: ctx.organizationId,
    });
  }

  async versionsForProduct(
    userId: string,
    productId: string,
    documentId: string,
  ) {
    const ctx = await this.ctx(userId);
    await this.assertOwnedProduct(ctx, productId);
    return this.documents.versions(documentId, {
      ownerType: EntityOwnerType.PRODUCT,
      ownerId: productId,
      organizationId: ctx.organizationId,
    });
  }
}
