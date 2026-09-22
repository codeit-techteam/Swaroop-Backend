import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DocumentCategory,
  DocumentStatus,
  EntityOwnerType,
  Prisma,
  StorageProvider,
  type Document,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { StorageService } from '../../../storage/storage.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { buildStorageKey } from '../common/document-keys.js';
import {
  generateUniqueDocumentNumber,
  isUniqueConstraintError,
} from '../common/document-number.js';
import { DocumentStateService } from '../common/document-state.service.js';
import { assertFileSize, assertMime } from '../common/document-validation.js';
import { PRODUCT_DOCUMENT_MIME_TYPES } from '../common/product-document.helpers.js';

export type CreateDocumentInput = {
  organizationId?: string | null;
  uploadedById: string;
  ownerType: EntityOwnerType;
  ownerId: string;
  category: DocumentCategory;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  fileType?: string;
  metadata?: Record<string, unknown>;
  expiresAt?: Date | string | null;
  paymentId?: string;
  dispatchId?: string;
  deliveryId?: string;
  purchaseOrderId?: string;
  customerProfileId?: string;
  sellerProfileId?: string;
  /** When set, storage keys use products/{productId}/... (no seller identity). */
  productId?: string;
  /**
   * When true, signed PUT URL is required (throws STORAGE_NOT_CONFIGURED).
   * When false/undefined, create succeeds without R2; uploadUrl only if configured.
   */
  requireUploadUrl?: boolean;
  status?: DocumentStatus;
  storageKey?: string;
};

export type ListDocumentsQuery = {
  page?: number;
  limit?: number;
  category?: DocumentCategory;
  status?: DocumentStatus;
  search?: string;
  organizationId?: string;
  ownerType?: EntityOwnerType;
  ownerId?: string;
};

export type ReplaceDocumentInput = {
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  metadata?: Record<string, unknown>;
  storageKey?: string;
  requireUploadUrl?: boolean;
  markPreviousReplaced?: boolean;
};

export type OwnershipFilter = {
  ownerType: EntityOwnerType;
  ownerId: string;
  organizationId?: string;
};

@Injectable()
export class DocumentsCoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly state: DocumentStateService,
  ) {}

  private resolveStorageProvider(): StorageProvider {
    return this.storage.isConfigured()
      ? StorageProvider.CLOUDFLARE_R2
      : StorageProvider.NONE;
  }

  mapDocument(doc: Document) {
    const { status, approved } = this.state.toApiStatus(doc.status);
    return {
      id: doc.id,
      documentNumber: doc.documentNumber,
      organizationId: doc.organizationId,
      uploadedById: doc.uploadedById,
      ownerType: doc.ownerType,
      ownerId: doc.ownerId,
      category: doc.category,
      fileName: doc.fileName,
      originalFileName: doc.originalFileName ?? doc.fileName,
      fileType: doc.fileType,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes?.toString() ?? null,
      storageProvider: doc.storageProvider,
      status,
      approved,
      version: doc.version,
      rootDocumentId: doc.rootDocumentId,
      previousDocumentId: doc.previousDocumentId,
      verificationNotes: doc.verificationNotes,
      approvedById: doc.approvedById,
      approvedAt: doc.approvedAt,
      rejectedById: doc.rejectedById,
      rejectedAt: doc.rejectedAt,
      rejectionReason: doc.rejectionReason,
      expiresAt: doc.expiresAt,
      metadata: doc.metadata,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async create(input: CreateDocumentInput) {
    if (input.productId) {
      if (
        !(PRODUCT_DOCUMENT_MIME_TYPES as readonly string[]).includes(
          input.mimeType,
        )
      ) {
        throw new BadRequestException(
          `Unsupported mime type. Allowed: ${PRODUCT_DOCUMENT_MIME_TYPES.join(', ')}`,
        );
      }
    } else {
      assertMime(input.mimeType);
    }
    assertFileSize(input.fileSizeBytes, this.storage.getMaxDocumentSizeBytes());

    const documentId = randomUUID();
    const storageKey =
      input.storageKey ??
      buildStorageKey({
        documentId,
        fileName: input.fileName,
        category: input.category,
        customerProfileId: input.customerProfileId ?? undefined,
        sellerProfileId: input.sellerProfileId ?? undefined,
        productId: input.productId ?? undefined,
        paymentId: input.paymentId,
        dispatchId: input.dispatchId,
        deliveryId: input.deliveryId,
        purchaseOrderId: input.purchaseOrderId,
      });

    const storageProvider = this.resolveStorageProvider();
    const status = input.status ?? DocumentStatus.UPLOADED;
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : undefined;

    let created: Document | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        created = await this.prisma.$transaction(async (tx) => {
          const documentNumber = await generateUniqueDocumentNumber(tx);
          const doc = await tx.document.create({
            data: {
              id: documentId,
              documentNumber,
              organizationId: input.organizationId ?? undefined,
              uploadedById: input.uploadedById,
              ownerType: input.ownerType,
              ownerId: input.ownerId,
              category: input.category,
              fileName: input.fileName,
              originalFileName: input.fileName,
              fileType: input.fileType,
              mimeType: input.mimeType,
              fileSizeBytes: BigInt(input.fileSizeBytes),
              storageProvider,
              storageKey,
              status,
              version: 1,
              expiresAt,
              metadata: input.metadata as Prisma.InputJsonValue | undefined,
            },
          });
          await tx.documentVersion.create({
            data: {
              documentId: doc.id,
              versionNumber: 1,
              storageKey,
              fileName: input.fileName,
              fileSizeBytes: BigInt(input.fileSizeBytes),
              mimeType: input.mimeType,
            },
          });
          return doc;
        });
        break;
      } catch (err) {
        if (isUniqueConstraintError(err)) continue;
        throw err;
      }
    }
    if (!created) {
      throw new BadRequestException('Failed to create document');
    }

    let uploadUrl: string | undefined;
    if (input.requireUploadUrl) {
      uploadUrl = await this.storage.getSignedUrl({
        key: storageKey,
        operation: 'put',
        contentType: input.mimeType,
      });
    } else if (this.storage.isConfigured()) {
      uploadUrl = await this.storage.getSignedUrl({
        key: storageKey,
        operation: 'put',
        contentType: input.mimeType,
      });
    }

    return {
      ...this.mapDocument(created),
      ...(uploadUrl !== undefined ? { uploadUrl } : {}),
    };
  }

  async list(query: ListDocumentsQuery) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.DocumentWhereInput = { deletedAt: null };
    if (query.category) where.category = query.category;
    if (query.status) where.status = query.status;
    if (query.organizationId) where.organizationId = query.organizationId;
    if (query.ownerType) where.ownerType = query.ownerType;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { fileName: { contains: q, mode: 'insensitive' } },
        { documentNumber: { contains: q, mode: 'insensitive' } },
        { originalFileName: { contains: q, mode: 'insensitive' } },
        { storageKey: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { versions: { orderBy: { versionNumber: 'desc' } } },
      }),
    ]);

    return {
      items: items.map((d) => this.mapDocument(d)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getById(id: string, ownership?: OwnershipFilter) {
    const doc = await this.requireDocument(id, ownership);
    return this.mapDocument(doc);
  }

  async replace(
    id: string,
    input: ReplaceDocumentInput,
    ownership?: OwnershipFilter,
  ) {
    const existing = await this.requireDocument(id, ownership);
    if (existing.ownerType === EntityOwnerType.PRODUCT) {
      if (
        !(PRODUCT_DOCUMENT_MIME_TYPES as readonly string[]).includes(
          input.mimeType,
        )
      ) {
        throw new BadRequestException(
          `Unsupported mime type. Allowed: ${PRODUCT_DOCUMENT_MIME_TYPES.join(', ')}`,
        );
      }
    } else {
      assertMime(input.mimeType);
    }
    assertFileSize(input.fileSizeBytes, this.storage.getMaxDocumentSizeBytes());

    const nextVersion = existing.version + 1;
    const storageKey =
      input.storageKey ??
      buildStorageKey({
        documentId: existing.id,
        fileName: input.fileName,
        category: existing.category,
        documentVersion: nextVersion,
        productId:
          existing.ownerType === EntityOwnerType.PRODUCT
            ? existing.ownerId
            : undefined,
        customerProfileId:
          existing.ownerType === EntityOwnerType.CUSTOMER
            ? existing.ownerId
            : undefined,
        sellerProfileId:
          existing.ownerType === EntityOwnerType.SELLER
            ? existing.ownerId
            : undefined,
      });

    const storageProvider = this.resolveStorageProvider();

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.documentVersion.create({
        data: {
          documentId: id,
          versionNumber: nextVersion,
          storageKey,
          fileName: input.fileName,
          fileSizeBytes: BigInt(input.fileSizeBytes),
          mimeType: input.mimeType,
        },
      });

      return tx.document.update({
        where: { id },
        data: {
          fileName: input.fileName,
          originalFileName: input.fileName,
          mimeType: input.mimeType,
          fileSizeBytes: BigInt(input.fileSizeBytes),
          storageKey,
          storageProvider,
          version: nextVersion,
          status: DocumentStatus.UNDER_REVIEW,
          approvedById: null,
          approvedAt: null,
          rejectedById: null,
          rejectedAt: null,
          rejectionReason: null,
          verificationNotes: null,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });
    });

    let uploadUrl: string | undefined;
    if (!input.storageKey) {
      if (input.requireUploadUrl) {
        uploadUrl = await this.storage.getSignedUrl({
          key: storageKey,
          operation: 'put',
          contentType: input.mimeType,
        });
      } else if (this.storage.isConfigured()) {
        uploadUrl = await this.storage.getSignedUrl({
          key: storageKey,
          operation: 'put',
          contentType: input.mimeType,
        });
      }
    }

    return {
      ...this.mapDocument(updated),
      version: nextVersion,
      ...(uploadUrl !== undefined ? { uploadUrl } : {}),
    };
  }

  async download(id: string, ownership?: OwnershipFilter) {
    const doc = await this.requireDocument(id, ownership);
    const url = await this.storage.getSignedUrl({
      key: doc.storageKey,
      operation: 'get',
    });
    return {
      id: doc.id,
      url,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      documentNumber: doc.documentNumber,
    };
  }

  async getUploadUrl(id: string, ownership?: OwnershipFilter) {
    const doc = await this.requireDocument(id, ownership);
    const url = await this.storage.getSignedUrl({
      key: doc.storageKey,
      operation: 'put',
      contentType: doc.mimeType ?? undefined,
    });
    return { id: doc.id, uploadUrl: url, storageKey: doc.storageKey };
  }

  async versions(id: string, ownership?: OwnershipFilter) {
    await this.requireDocument(id, ownership);
    const versions = await this.prisma.documentVersion.findMany({
      where: { documentId: id },
      orderBy: { versionNumber: 'desc' },
    });
    return versions.map((v) => ({
      ...v,
      fileSizeBytes: v.fileSizeBytes?.toString() ?? null,
    }));
  }

  async approve(
    id: string,
    actorUserId: string,
    opts?: { notes?: string; reason?: string },
  ) {
    const existing = await this.requireDocument(id);
    this.state.assertTransition(existing.status, this.state.approveTarget());

    const notes = opts?.notes ?? opts?.reason ?? existing.verificationNotes;
    const doc = await this.prisma.document.update({
      where: { id },
      data: {
        status: DocumentStatus.VERIFIED,
        verificationNotes: notes,
        approvedById: actorUserId,
        approvedAt: new Date(),
        rejectedById: null,
        rejectedAt: null,
        rejectionReason: null,
      },
    });
    return this.mapDocument(doc);
  }

  async reject(
    id: string,
    actorUserId: string,
    opts: { reason?: string; notes?: string },
  ) {
    const existing = await this.requireDocument(id);
    const reason = (opts.reason ?? opts.notes)?.trim();
    if (!reason) {
      throw new BadRequestException('Rejection reason is required');
    }
    this.state.assertTransition(existing.status, DocumentStatus.REJECTED);

    const doc = await this.prisma.document.update({
      where: { id },
      data: {
        status: DocumentStatus.REJECTED,
        verificationNotes: reason,
        rejectionReason: reason,
        rejectedById: actorUserId,
        rejectedAt: new Date(),
        approvedById: null,
        approvedAt: null,
      },
    });
    return this.mapDocument(doc);
  }

  async softDelete(id: string, ownership?: OwnershipFilter) {
    const existing = await this.requireDocument(id, ownership);
    this.state.assertTransition(existing.status, DocumentStatus.ARCHIVED);
    await this.prisma.document.update({
      where: { id },
      data: { deletedAt: new Date(), status: DocumentStatus.ARCHIVED },
    });
    return { id, deleted: true };
  }

  async listExpiring(days = 30) {
    const safeDays = Math.max(1, Math.min(365, days));
    const now = new Date();
    const until = new Date(now.getTime() + safeDays * 24 * 60 * 60 * 1000);

    const items = await this.prisma.document.findMany({
      where: {
        deletedAt: null,
        expiresAt: { gte: now, lte: until },
      },
      orderBy: { expiresAt: 'asc' },
      take: 200,
      include: {
        organization: {
          select: { id: true, name: true, legalName: true },
        },
      },
    });

    return {
      days: safeDays,
      items: items.map((d) => ({
        ...this.mapDocument(d),
        organization: d.organization,
      })),
    };
  }

  /**
   * Link a payment-proof document onto payment.metadata.proofDocumentId.
   * Does not require R2.
   */
  async linkPaymentProof(paymentId: string, documentId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.category !== DocumentCategory.PAYMENT_PROOF) {
      throw new BadRequestException(
        'Document category must be PAYMENT_PROOF to link as payment proof',
      );
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    const prev =
      payment.metadata && typeof payment.metadata === 'object'
        ? (payment.metadata as Record<string, unknown>)
        : {};

    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        metadata: {
          ...prev,
          proofDocumentId: documentId,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      paymentId: updated.id,
      proofDocumentId: documentId,
    };
  }

  async assertDocumentCategory(
    documentId: string,
    category: DocumentCategory,
  ): Promise<Document> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.category !== category) {
      throw new BadRequestException(`Document category must be ${category}`);
    }
    return doc;
  }

  async requireDocument(id: string, ownership?: OwnershipFilter) {
    const doc = await this.prisma.document.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(ownership?.organizationId
          ? { organizationId: ownership.organizationId }
          : {}),
        ...(ownership
          ? { ownerType: ownership.ownerType, ownerId: ownership.ownerId }
          : {}),
      },
    });
    if (!doc) {
      if (ownership) {
        const any = await this.prisma.document.findFirst({
          where: { id, deletedAt: null },
          select: { id: true },
        });
        if (any) {
          throw new ForbiddenException('Document access denied');
        }
      }
      throw new NotFoundException('Document not found');
    }
    return doc;
  }
}
