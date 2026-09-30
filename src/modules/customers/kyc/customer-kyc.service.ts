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
  StorageProvider,
  VerificationStatus,
  type Document,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { StorageService } from '../../../storage/storage.service.js';
import {
  assertFileSize,
  assertMime,
} from '../../documents/common/document-validation.js';
import { DocumentStateService } from '../../documents/common/document-state.service.js';
import {
  openChangeRequest,
  resolvedChangeRequest,
} from '../../documents/common/kyc-change-request.js';
import { DocumentsCoreService } from '../../documents/services/documents-core.service.js';
import {
  isR2Confirmed,
  readJsonObject,
} from '../../sellers/onboarding/onboarding-documents.slots.js';
import { CustomerAuditService } from '../common/customer-audit.service.js';
import {
  CustomerContext,
  CustomerContextService,
} from '../common/customer-context.service.js';
import type {
  CreateCustomerKycDocumentDto,
  SubmitCustomerKycDto,
} from './customer-kyc.dto.js';
import {
  CUSTOMER_KYC_DOCUMENT_PURPOSE,
  CUSTOMER_KYC_DOCUMENT_SLOTS,
  isCustomerKycDocumentMeta,
  readCustomerKycState,
  resolveCustomerKycSlot,
  withCustomerKycState,
  type CustomerKycDocumentSlot,
  type CustomerKycStatus,
} from './customer-kyc.slots.js';

const ACTIVE_STATUSES: DocumentStatus[] = [
  DocumentStatus.UPLOADED,
  DocumentStatus.UNDER_REVIEW,
  DocumentStatus.VERIFIED,
  DocumentStatus.REJECTED,
];

const LOCKED_KYC_STATUSES = new Set<CustomerKycStatus>([
  'SUBMITTED',
  'APPROVED',
]);

@Injectable()
export class CustomerKycService {
  private readonly logger = new Logger(CustomerKycService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customerContext: CustomerContextService,
    private readonly documents: DocumentsCoreService,
    private readonly storage: StorageService,
    private readonly state: DocumentStateService,
    private readonly audit: CustomerAuditService,
  ) {}

  async overview(userId: string) {
    const ctx = await this.customerContext.getOrCreateCustomer(userId);
    const [profile, organization] = await Promise.all([
      this.prisma.customerProfile.findUniqueOrThrow({
        where: { id: ctx.customerProfileId },
        select: { metadata: true },
      }),
      this.prisma.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: {
          name: true,
          legalName: true,
          gstin: true,
          pan: true,
          verificationStatus: true,
        },
      }),
    ]);
    const kyc = readCustomerKycState(profile.metadata);
    const changeRequest =
      kyc.status === 'CHANGES_REQUESTED'
        ? openChangeRequest(kyc.changeRequest)
        : null;

    const slots = [];
    const missingRequired: string[] = [];
    for (const def of CUSTOMER_KYC_DOCUMENT_SLOTS) {
      const rows = await this.findSlotDocuments(ctx, def.slot);
      const current =
        rows.find((row) => this.countsAsStored(row)) ??
        rows.find(
          (row) =>
            row.status === DocumentStatus.REJECTED &&
            isR2Confirmed(readJsonObject(row.metadata)),
        );
      if (def.required && (!current || !this.countsAsStored(current))) {
        missingRequired.push(def.name);
      }
      slots.push({
        slot: def.slot,
        category: def.category,
        name: def.name,
        description: def.description,
        required: def.required,
        changeRequested: Boolean(changeRequest?.slots.includes(def.slot)),
        document: current ? this.toView(current) : null,
      });
    }

    const locked = LOCKED_KYC_STATUSES.has(kyc.status);
    return {
      status: kyc.status,
      submittedAt: kyc.submittedAt,
      reviewedAt: kyc.reviewedAt,
      reviewNotes: kyc.reviewNotes,
      rejectedReason: kyc.status === 'REJECTED' ? kyc.rejectedReason : null,
      changeRequest,
      locked,
      canSubmit: !locked && missingRequired.length === 0,
      missingRequired,
      organization: {
        name: organization.name,
        legalName: organization.legalName,
        gstin: organization.gstin,
        pan: organization.pan,
        verificationStatus: organization.verificationStatus,
      },
      slots,
    };
  }

  async createUpload(userId: string, dto: CreateCustomerKycDocumentDto) {
    const slotDef = resolveCustomerKycSlot(dto.slot);
    if (!slotDef) throw new BadRequestException('Unknown KYC document');

    const fileName = this.sanitizeFileName(dto.fileName);
    assertMime(dto.mimeType);
    assertFileSize(dto.fileSizeBytes, this.storage.getMaxDocumentSizeBytes());
    this.storage.assertConfigured();

    const ctx = await this.customerContext.getOrCreateCustomer(userId);
    await this.assertSlotWritable(ctx, slotDef.slot);
    await this.discardUnconfirmed(ctx, slotDef.slot);

    const created = await this.documents.create({
      organizationId: ctx.organizationId,
      uploadedById: userId,
      ownerType: EntityOwnerType.CUSTOMER,
      ownerId: ctx.customerProfileId,
      customerProfileId: ctx.customerProfileId,
      category: slotDef.category,
      fileName,
      mimeType: dto.mimeType,
      fileSizeBytes: dto.fileSizeBytes,
      metadata: {
        purpose: CUSTOMER_KYC_DOCUMENT_PURPOSE,
        slot: slotDef.slot,
        r2Confirmed: false,
        uploadSource: dto.source ?? null,
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
      action: 'CUSTOMER_KYC_DOCUMENT_UPLOAD_STARTED',
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
    const { ctx, doc, meta } = await this.requireKycDocument(
      userId,
      documentId,
    );
    const slot = meta.slot as CustomerKycDocumentSlot;
    await this.assertSlotWritable(ctx, slot, doc.id);

    if (this.countsAsStored(doc)) {
      if (!(await this.storage.exists(doc.storageKey))) {
        throw new BadRequestException(
          'Stored file is missing from storage. Upload the document again.',
        );
      }
      return this.toView(doc);
    }

    if (!(await this.storage.exists(doc.storageKey))) {
      throw new BadRequestException(
        'File is not in storage yet. Finish the upload, then confirm.',
      );
    }

    this.state.assertTransition(doc.status, DocumentStatus.UNDER_REVIEW);
    const updated = await this.prisma.document.update({
      where: { id: doc.id },
      data: {
        status: DocumentStatus.UNDER_REVIEW,
        metadata: {
          ...meta,
          purpose: CUSTOMER_KYC_DOCUMENT_PURPOSE,
          slot,
          r2Confirmed: true,
          r2ConfirmedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    await this.archivePrevious(ctx, slot, updated.id);

    await this.audit.log({
      action: 'CUSTOMER_KYC_DOCUMENT_STORED',
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
    const { ctx, doc, meta } = await this.requireKycDocument(
      userId,
      documentId,
    );
    if (await this.isLocked(ctx)) {
      throw new BadRequestException(
        'KYC documents are locked while under review. Only rejected documents can be replaced.',
      );
    }
    await this.archiveDocument(doc, { deleteObject: true });

    await this.audit.log({
      action: 'CUSTOMER_KYC_DOCUMENT_REMOVED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: doc.id,
      metadata: { slot: meta.slot },
    });

    return { id: doc.id, deleted: true };
  }

  async download(userId: string, documentId: string) {
    const { ctx, doc } = await this.requireKycDocument(userId, documentId);
    if (!isR2Confirmed(readJsonObject(doc.metadata))) {
      throw new BadRequestException('Document is not stored yet');
    }
    return this.documents.download(
      documentId,
      {
        ownerType: EntityOwnerType.CUSTOMER,
        ownerId: ctx.customerProfileId,
        organizationId: ctx.organizationId,
      },
      { disposition: 'inline', verifyExists: true },
    );
  }

  async submit(userId: string, dto: SubmitCustomerKycDto) {
    const ctx = await this.customerContext.getOrCreateCustomer(userId);
    const profile = await this.prisma.customerProfile.findUniqueOrThrow({
      where: { id: ctx.customerProfileId },
      select: { metadata: true },
    });
    const kyc = readCustomerKycState(profile.metadata);
    if (kyc.status === 'APPROVED') {
      throw new BadRequestException('KYC is already approved');
    }
    if (kyc.status === 'SUBMITTED') {
      throw new BadRequestException('KYC is already under review');
    }

    const missing: string[] = [];
    for (const def of CUSTOMER_KYC_DOCUMENT_SLOTS) {
      if (!def.required) continue;
      const rows = await this.findSlotDocuments(ctx, def.slot);
      const current = rows.find((row) => this.countsAsStored(row));
      if (!current || !(await this.storage.exists(current.storageKey))) {
        missing.push(def.name);
      }
    }
    if (missing.length) {
      throw new BadRequestException(
        `Upload the required KYC documents first: ${missing.join(', ')}`,
      );
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.customerProfile.update({
        where: { id: ctx.customerProfileId },
        data: {
          metadata: withCustomerKycState(profile.metadata, {
            status: 'SUBMITTED',
            submittedAt: now.toISOString(),
            rejectedReason: null,
            changeRequest: resolvedChangeRequest(kyc.changeRequest, now),
          }) as Prisma.InputJsonValue,
        },
      });
      await tx.organization.update({
        where: { id: ctx.organizationId },
        data: {
          verificationStatus: VerificationStatus.UNDER_REVIEW,
          ...(dto.businessName?.trim()
            ? {
                name: dto.businessName.trim(),
                legalName: dto.businessName.trim(),
              }
            : {}),
          ...(dto.gstin ? { gstin: dto.gstin } : {}),
          ...(dto.pan ? { pan: dto.pan } : {}),
        },
      });
    });

    await this.audit.log({
      action: 'CUSTOMER_KYC_SUBMITTED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.CUSTOMER,
      entityId: ctx.customerProfileId,
      metadata: { resubmission: kyc.status !== 'NOT_SUBMITTED' },
    });

    return this.overview(userId);
  }

  private async isLocked(ctx: CustomerContext): Promise<boolean> {
    const profile = await this.prisma.customerProfile.findUnique({
      where: { id: ctx.customerProfileId },
      select: { metadata: true },
    });
    return LOCKED_KYC_STATUSES.has(
      readCustomerKycState(profile?.metadata).status,
    );
  }

  /**
   * While KYC is under review or approved, a slot is only writable when the
   * admin rejected its current file, so the customer can send a replacement.
   */
  private async assertSlotWritable(
    ctx: CustomerContext,
    slot: CustomerKycDocumentSlot,
    pendingDocumentId?: string,
  ) {
    if (!(await this.isLocked(ctx))) return;
    const rows = await this.findSlotDocuments(ctx, slot);
    const hasActive = rows.some(
      (row) => row.id !== pendingDocumentId && this.countsAsStored(row),
    );
    const hasRejected = rows.some(
      (row) =>
        row.status === DocumentStatus.REJECTED &&
        isR2Confirmed(readJsonObject(row.metadata)),
    );
    if (hasActive || !hasRejected) {
      throw new BadRequestException(
        'KYC documents are locked while under review. Only documents rejected by the admin team can be re-uploaded.',
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

  private async requireKycDocument(userId: string, documentId: string) {
    const ctx = await this.customerContext.requireCustomer(userId);
    const doc = await this.documents.requireDocument(documentId, {
      ownerType: EntityOwnerType.CUSTOMER,
      ownerId: ctx.customerProfileId,
      organizationId: ctx.organizationId,
    });
    const meta = readJsonObject(doc.metadata);
    if (!isCustomerKycDocumentMeta(meta)) {
      throw new BadRequestException('Document is not a KYC file');
    }
    return { ctx, doc, meta };
  }

  private async findSlotDocuments(
    ctx: CustomerContext,
    slot: CustomerKycDocumentSlot,
  ) {
    const def = resolveCustomerKycSlot(slot);
    if (!def) return [];
    const rows = await this.prisma.document.findMany({
      where: {
        deletedAt: null,
        organizationId: ctx.organizationId,
        ownerType: EntityOwnerType.CUSTOMER,
        ownerId: ctx.customerProfileId,
        category: def.category,
        status: { in: ACTIVE_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.filter((row) =>
      isCustomerKycDocumentMeta(readJsonObject(row.metadata), slot),
    );
  }

  private async discardUnconfirmed(
    ctx: CustomerContext,
    slot: CustomerKycDocumentSlot,
  ) {
    const rows = await this.findSlotDocuments(ctx, slot);
    for (const row of rows) {
      if (isR2Confirmed(readJsonObject(row.metadata))) continue;
      await this.archiveDocument(row, { deleteObject: true });
    }
  }

  private async archivePrevious(
    ctx: CustomerContext,
    slot: CustomerKycDocumentSlot,
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
        `Failed to delete storage object ${doc.storageKey}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
