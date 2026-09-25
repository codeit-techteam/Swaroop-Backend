import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DocumentStatus,
  EntityOwnerType,
  Prisma,
  SellerOnboardingStatus,
  StorageProvider,
  type Document,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { StorageService } from '../../../storage/storage.service.js';
import { assertFileSize, assertMime } from '../../documents/common/document-validation.js';
import { DocumentStateService } from '../../documents/common/document-state.service.js';
import { DocumentsCoreService } from '../../documents/services/documents-core.service.js';
import { SellerAuditService } from '../common/seller-audit.service.js';
import {
  SellerContext,
  SellerContextService,
} from '../common/seller-context.service.js';
import type { CreateOnboardingDocumentDto } from './onboarding-documents.dto.js';
import {
  SELLER_ONBOARDING_DOCUMENT_PURPOSE,
  SELLER_ONBOARDING_DOCUMENT_SLOTS,
  isOnboardingDocumentMeta,
  isR2Confirmed,
  readJsonObject,
  resolveOnboardingSlot,
  type SellerOnboardingDocumentSlot,
} from './onboarding-documents.slots.js';

const ACTIVE_STATUSES: DocumentStatus[] = [
  DocumentStatus.UPLOADED,
  DocumentStatus.UNDER_REVIEW,
  DocumentStatus.VERIFIED,
  DocumentStatus.REJECTED,
];

const LOCKED_ONBOARDING_STATUSES = new Set<SellerOnboardingStatus>([
  SellerOnboardingStatus.SUBMITTED,
  SellerOnboardingStatus.UNDER_REVIEW,
  SellerOnboardingStatus.APPROVED,
]);

@Injectable()
export class OnboardingDocumentsService {
  private readonly logger = new Logger(OnboardingDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerContext: SellerContextService,
    private readonly documents: DocumentsCoreService,
    private readonly storage: StorageService,
    private readonly state: DocumentStateService,
    private readonly audit: SellerAuditService,
  ) {}

  async list(userId: string) {
    const ctx = await this.sellerContext.getOrCreateDraftSeller(userId);
    const slots = [];
    for (const def of SELLER_ONBOARDING_DOCUMENT_SLOTS) {
      const rows = await this.findSlotDocuments(ctx, def.slot);
      const current =
        rows.find((row) => this.countsAsStored(row)) ??
        rows.find(
          (row) =>
            row.status === DocumentStatus.REJECTED &&
            isR2Confirmed(readJsonObject(row.metadata)),
        );
      slots.push({
        slot: def.slot,
        category: def.category,
        name: def.name,
        description: def.description,
        required: def.required,
        document: current ? this.toView(current) : null,
      });
    }
    return { slots };
  }

  /**
   * Create the document row and a signed R2 PUT URL.
   * The file is not treated as stored until confirm() sees the object.
   */
  async createUpload(userId: string, dto: CreateOnboardingDocumentDto) {
    const slotDef = resolveOnboardingSlot(dto.slot);
    if (!slotDef) {
      throw new BadRequestException('Unknown onboarding document');
    }

    const fileName = this.sanitizeFileName(dto.fileName);
    assertMime(dto.mimeType);
    assertFileSize(dto.fileSizeBytes, this.storage.getMaxDocumentSizeBytes());
    this.storage.assertConfigured();

    const ctx = await this.sellerContext.getOrCreateDraftSeller(userId);
    await this.assertMutable(ctx.sellerProfileId);
    await this.discardUnconfirmed(ctx, slotDef.slot);

    const created = await this.documents.create({
      organizationId: ctx.organizationId,
      uploadedById: userId,
      ownerType: EntityOwnerType.SELLER,
      ownerId: ctx.sellerProfileId,
      sellerProfileId: ctx.sellerProfileId,
      category: slotDef.category,
      fileName,
      mimeType: dto.mimeType,
      fileSizeBytes: dto.fileSizeBytes,
      metadata: {
        purpose: SELLER_ONBOARDING_DOCUMENT_PURPOSE,
        slot: slotDef.slot,
        r2Confirmed: false,
      },
      status: DocumentStatus.UPLOADED,
      requireUploadUrl: true,
    });

    if (!created.uploadUrl) {
      throw new ServiceUnavailableException(
        'Storage upload URL was not issued. Configure Cloudflare R2 and retry.',
      );
    }

    await this.audit.log({
      action: 'SELLER_ONBOARDING_DOCUMENT_UPLOAD_STARTED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: created.id,
      metadata: { slot: slotDef.slot, category: slotDef.category },
    });

    return {
      id: created.id,
      slot: slotDef.slot,
      category: slotDef.category,
      fileName: created.originalFileName ?? created.fileName,
      mimeType: created.mimeType,
      fileSizeBytes: created.fileSizeBytes,
      status: created.status,
      r2Confirmed: false,
      uploadUrl: created.uploadUrl,
    };
  }

  async confirm(userId: string, documentId: string) {
    const { ctx, doc, meta } = await this.requireOnboardingDocument(
      userId,
      documentId,
    );
    await this.assertMutable(ctx.sellerProfileId);
    const slot = meta.slot as SellerOnboardingDocumentSlot;

    if (this.countsAsStored(doc)) {
      const stillThere = await this.storage.exists(doc.storageKey);
      if (!stillThere) {
        throw new BadRequestException(
          'Stored file is missing from R2. Upload the document again.',
        );
      }
      return this.toView(doc);
    }

    const stored = await this.storage.exists(doc.storageKey);
    if (!stored) {
      throw new BadRequestException(
        'File is not in R2 yet. Finish the upload, then confirm.',
      );
    }

    this.state.assertTransition(doc.status, DocumentStatus.UNDER_REVIEW);
    const updated = await this.prisma.document.update({
      where: { id: doc.id },
      data: {
        status: DocumentStatus.UNDER_REVIEW,
        metadata: {
          ...meta,
          purpose: SELLER_ONBOARDING_DOCUMENT_PURPOSE,
          slot,
          r2Confirmed: true,
          r2ConfirmedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    await this.archivePrevious(ctx, slot, updated.id);
    await this.rememberSlotDocument(ctx, slot, updated.id);

    await this.audit.log({
      action: 'SELLER_ONBOARDING_DOCUMENT_STORED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: updated.id,
      metadata: {
        slot,
        category: updated.category,
        storageProvider: StorageProvider.CLOUDFLARE_R2,
        storageKey: updated.storageKey,
      },
    });

    return this.toView(updated);
  }

  async remove(userId: string, documentId: string) {
    const { ctx, doc, meta } = await this.requireOnboardingDocument(
      userId,
      documentId,
    );
    await this.assertMutable(ctx.sellerProfileId);
    const slot = meta.slot as SellerOnboardingDocumentSlot;
    await this.archiveDocument(doc, { deleteObject: true });
    await this.rememberSlotDocument(ctx, slot, null);

    await this.audit.log({
      action: 'SELLER_ONBOARDING_DOCUMENT_REMOVED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: doc.id,
      metadata: { slot },
    });

    return { id: doc.id, deleted: true };
  }

  async download(userId: string, documentId: string) {
    const { ctx, doc } = await this.requireOnboardingDocument(userId, documentId);
    if (!this.countsAsStored(doc)) {
      throw new BadRequestException('Document is not stored yet');
    }
    return this.documents.download(documentId, {
      ownerType: EntityOwnerType.SELLER,
      ownerId: ctx.sellerProfileId,
      organizationId: ctx.organizationId,
    });
  }

  /** Names of required slots that are not confirmed in R2. */
  async missingRequiredLabels(userId: string): Promise<string[]> {
    const ctx = await this.sellerContext.requireSeller(userId);
    const missing: string[] = [];
    for (const def of SELLER_ONBOARDING_DOCUMENT_SLOTS) {
      if (!def.required) continue;
      const rows = await this.findSlotDocuments(ctx, def.slot);
      const current = rows.find((row) => this.countsAsStored(row));
      if (!current) {
        missing.push(def.name);
        continue;
      }
      const stored = await this.storage.exists(current.storageKey);
      if (!stored) missing.push(def.name);
    }
    return missing;
  }

  private async assertMutable(sellerProfileId: string) {
    const onboarding = await this.prisma.sellerOnboarding.findUnique({
      where: { sellerProfileId },
      select: { status: true },
    });
    if (onboarding && LOCKED_ONBOARDING_STATUSES.has(onboarding.status)) {
      throw new BadRequestException(
        'Onboarding documents are locked after submission. Contact support to re-upload.',
      );
    }
  }

  private countsAsStored(doc: Document): boolean {
    if (doc.status === DocumentStatus.REJECTED) return false;
    if (doc.status === DocumentStatus.ARCHIVED) return false;
    if (doc.status === DocumentStatus.REPLACED) return false;
    return isR2Confirmed(readJsonObject(doc.metadata));
  }

  private toView(doc: Document) {
    const meta = readJsonObject(doc.metadata);
    return {
      id: doc.id,
      slot: typeof meta.slot === 'string' ? meta.slot : null,
      category: doc.category,
      fileName: doc.originalFileName ?? doc.fileName,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes?.toString() ?? null,
      status: doc.status,
      r2Confirmed: isR2Confirmed(meta),
      storageProvider: doc.storageProvider,
      storageKey: doc.storageKey,
      rejectionReason: doc.rejectionReason,
      uploadedAt: doc.createdAt,
    };
  }

  private sanitizeFileName(fileName: string): string {
    const base = fileName.split(/[/\\]/).pop()?.trim() ?? '';
    if (!base || base === '.' || base === '..') {
      throw new BadRequestException('fileName is required');
    }
    return base.slice(0, 255);
  }

  private async requireOnboardingDocument(userId: string, documentId: string) {
    const ctx = await this.sellerContext.requireSeller(userId);
    const doc = await this.documents.requireDocument(documentId, {
      ownerType: EntityOwnerType.SELLER,
      ownerId: ctx.sellerProfileId,
      organizationId: ctx.organizationId,
    });
    const meta = readJsonObject(doc.metadata);
    if (!isOnboardingDocumentMeta(meta)) {
      throw new BadRequestException('Document is not a seller onboarding file');
    }
    return { ctx, doc, meta };
  }

  private async findSlotDocuments(
    ctx: SellerContext,
    slot: SellerOnboardingDocumentSlot,
  ) {
    const def = resolveOnboardingSlot(slot);
    if (!def) return [];
    const rows = await this.prisma.document.findMany({
      where: {
        deletedAt: null,
        organizationId: ctx.organizationId,
        ownerType: EntityOwnerType.SELLER,
        ownerId: ctx.sellerProfileId,
        category: def.category,
        status: { in: ACTIVE_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.filter((row) =>
      isOnboardingDocumentMeta(readJsonObject(row.metadata), slot),
    );
  }

  private async discardUnconfirmed(
    ctx: SellerContext,
    slot: SellerOnboardingDocumentSlot,
  ) {
    const rows = await this.findSlotDocuments(ctx, slot);
    for (const row of rows) {
      if (isR2Confirmed(readJsonObject(row.metadata))) continue;
      await this.archiveDocument(row, { deleteObject: true });
    }
  }

  private async archivePrevious(
    ctx: SellerContext,
    slot: SellerOnboardingDocumentSlot,
    keepId: string,
  ) {
    const rows = await this.findSlotDocuments(ctx, slot);
    for (const row of rows) {
      if (row.id === keepId) continue;
      await this.archiveDocument(row, { deleteObject: false });
    }
  }

  private async archiveDocument(
    doc: Document,
    options: { deleteObject: boolean },
  ) {
    if (doc.deletedAt || doc.status === DocumentStatus.ARCHIVED) return;
    this.state.assertTransition(doc.status, DocumentStatus.ARCHIVED);
    await this.prisma.document.update({
      where: { id: doc.id },
      data: { deletedAt: new Date(), status: DocumentStatus.ARCHIVED },
    });

    if (!options.deleteObject || !doc.storageKey) return;
    if (!this.storage.isConfigured()) return;
    try {
      await this.storage.delete(doc.storageKey);
    } catch (error) {
      this.logger.warn(
        `Failed to delete R2 object ${doc.storageKey}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async rememberSlotDocument(
    ctx: SellerContext,
    slot: SellerOnboardingDocumentSlot,
    documentId: string | null,
  ) {
    const onboarding = await this.prisma.sellerOnboarding.findUnique({
      where: { sellerProfileId: ctx.sellerProfileId },
    });
    if (!onboarding) return;
    const prev = readJsonObject(onboarding.metadata);
    const documents = readJsonObject(prev.documents);
    await this.prisma.sellerOnboarding.update({
      where: { id: onboarding.id },
      data: {
        metadata: {
          ...prev,
          documents: { ...documents, [slot]: documentId },
        } as Prisma.InputJsonValue,
      },
    });
  }
}
