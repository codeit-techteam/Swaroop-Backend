import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DocumentStatus,
  EntityOwnerType,
  KycVerificationStatus,
  Prisma,
  StorageProvider,
  VerificationStatus,
  type Document,
  type KycVerification,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { StorageService } from '../../../storage/storage.service.js';
import { NotificationService } from '../../notifications/notification.service.js';
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
import { lockCustomerKyc } from './customer-kyc.lock.js';
import {
  CUSTOMER_KYC_DOCUMENT_PURPOSE,
  CUSTOMER_KYC_DOCUMENT_SLOTS,
  isCustomerKycDocumentMeta,
  isCustomerKycVerified,
  readCustomerKycState,
  resolveCustomerKycSlot,
  withCustomerKycState,
  type CustomerKycDocumentSlot,
  type CustomerKycStatus,
} from './customer-kyc.slots.js';
import { hashIdentifier } from '../../kyc-verification/kyc-identifiers.js';
import {
  hasPanGstMismatch,
  latestVerifications,
  PAN_GST_MISMATCH_MESSAGE,
  toVerificationView,
  verificationSatisfied,
} from '../../kyc-verification/kyc-verification.records.js';

type ChecklistState = 'done' | 'pending' | 'attention' | 'todo';

type ChecklistItem = {
  key: 'pan' | 'gst' | 'documents' | 'review';
  label: string;
  state: ChecklistState;
  detail: string;
};

type Verifications = {
  pan: KycVerification | null;
  gst: KycVerification | null;
};

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
    private readonly notifications: NotificationService,
  ) {}

  async overview(userId: string) {
    const ctx = await this.customerContext.getOrCreateCustomer(userId);
    const [profile, organization, verifications] = await Promise.all([
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
      latestVerifications(
        this.prisma,
        EntityOwnerType.CUSTOMER,
        ctx.customerProfileId,
      ),
    ]);
    const kyc = readCustomerKycState(profile.metadata);
    const changeRequest =
      kyc.status === 'CHANGES_REQUESTED'
        ? openChangeRequest(kyc.changeRequest)
        : null;

    const slots = [];
    const missingDocuments: string[] = [];
    let rejectedDocuments = 0;
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
        missingDocuments.push(def.name);
      }
      if (current?.status === DocumentStatus.REJECTED) rejectedDocuments += 1;
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
    const kycVerified = isCustomerKycVerified(
      kyc.status,
      organization.verificationStatus,
    );
    const verificationBlockers = this.verificationBlockers(
      verifications,
      organization.gstin,
    );
    const missingRequired = [...verificationBlockers, ...missingDocuments];
    return {
      status: kyc.status,
      kycVerified,
      submittedAt: kyc.submittedAt,
      reviewedAt: kyc.reviewedAt,
      reviewNotes: kyc.reviewNotes,
      rejectedReason: kyc.status === 'REJECTED' ? kyc.rejectedReason : null,
      changeRequest,
      locked,
      canSubmit: !locked && !kycVerified && missingRequired.length === 0,
      missingRequired,
      verifications: {
        pan: verifications.pan ? toVerificationView(verifications.pan) : null,
        gst: verifications.gst ? toVerificationView(verifications.gst) : null,
        mismatch: hasPanGstMismatch(
          verifications.pan,
          verifications.gst,
          organization.gstin,
        ),
      },
      checklist: this.checklist({
        status: kyc.status,
        kycVerified,
        verifications,
        missingDocuments,
        rejectedDocuments,
      }),
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
    const previous = await this.latestStoredVersion(ctx, slotDef.slot);

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

    const version = previous ? previous.version + 1 : 1;
    if (previous) {
      await this.prisma.document.update({
        where: { id: created.id },
        data: {
          version,
          rootDocumentId: previous.rootDocumentId ?? previous.id,
          previousDocumentId: previous.id,
        },
      });
    }

    await this.audit.log({
      action: 'CUSTOMER_KYC_DOCUMENT_UPLOAD_STARTED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: created.id,
      metadata: {
        actorRole: 'CUSTOMER',
        slot: slotDef.slot,
        category: slotDef.category,
        version,
      },
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

    const replacedIds = await this.supersedePrevious(ctx, slot, updated.id);

    await this.audit.log({
      action: replacedIds.length
        ? 'CUSTOMER_KYC_DOCUMENT_REPLACED'
        : 'CUSTOMER_KYC_DOCUMENT_UPLOADED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: updated.id,
      metadata: {
        actorRole: 'CUSTOMER',
        slot,
        category: updated.category,
        version: updated.version,
        replacedDocumentIds: replacedIds,
        fileName: updated.originalFileName ?? updated.fileName,
        storageProvider: StorageProvider.CLOUDFLARE_R2,
      },
    });

    return this.toView(updated);
  }

  async remove(userId: string, documentId: string) {
    const { ctx, doc, meta } = await this.requireKycDocument(
      userId,
      documentId,
    );
    const status = await this.kycStatus(ctx);
    if (LOCKED_KYC_STATUSES.has(status)) {
      throw new BadRequestException(
        'KYC documents are locked while under review. Only rejected documents can be replaced.',
      );
    }
    // Files from a KYC that was ever submitted may have been reviewed, so the
    // object is kept for audit; only never-submitted drafts are deleted.
    const deleteObject =
      status === 'NOT_SUBMITTED' ||
      !isR2Confirmed(readJsonObject(doc.metadata));
    await this.archiveDocument(doc, { deleteObject });

    await this.audit.log({
      action: 'CUSTOMER_KYC_DOCUMENT_REMOVED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: doc.id,
      metadata: {
        actorRole: 'CUSTOMER',
        slot: meta.slot,
        storageObjectDeleted: deleteObject,
      },
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
    const initialStatus = await this.kycStatus(ctx);
    if (initialStatus === 'APPROVED') {
      throw new BadRequestException('KYC is already approved');
    }
    // A repeated submit (double click, retry after a timeout) is a no-op.
    if (initialStatus === 'SUBMITTED') return this.overview(userId);

    const [verifications, organization] = await Promise.all([
      latestVerifications(
        this.prisma,
        EntityOwnerType.CUSTOMER,
        ctx.customerProfileId,
      ),
      this.prisma.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { gstin: true },
      }),
    ]);
    const blockers = this.verificationBlockers(
      verifications,
      organization.gstin,
    );
    if (blockers.length) {
      throw new BadRequestException(
        `Complete these steps before submitting: ${blockers.join(', ')}`,
      );
    }
    this.assertMatchesVerified(dto, verifications);

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

    // GST-verified legal name wins over whatever the customer typed.
    const verifiedLegalName =
      verifications.gst?.status === KycVerificationStatus.VERIFIED
        ? toVerificationView(verifications.gst).details.legalName
        : null;
    const businessName = dto.businessName?.trim() || null;

    const now = new Date();
    const previousStatus = await this.prisma.$transaction(async (tx) => {
      const { metadata, kyc } = await lockCustomerKyc(
        tx,
        ctx.customerProfileId,
      );
      if (LOCKED_KYC_STATUSES.has(kyc.status)) return null;
      await tx.customerProfile.update({
        where: { id: ctx.customerProfileId },
        data: {
          metadata: withCustomerKycState(metadata, {
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
          ...(businessName ? { name: businessName } : {}),
          ...(verifiedLegalName || businessName
            ? { legalName: verifiedLegalName ?? businessName }
            : {}),
        },
      });
      return kyc.status;
    });

    // Another request submitted (or an admin decided) while this one ran.
    if (previousStatus === null) return this.overview(userId);

    const resubmission = previousStatus !== 'NOT_SUBMITTED';
    await this.audit.log({
      action: resubmission
        ? 'CUSTOMER_KYC_RESUBMITTED'
        : 'CUSTOMER_KYC_SUBMITTED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.CUSTOMER,
      entityId: ctx.customerProfileId,
      metadata: {
        actorRole: 'CUSTOMER',
        resubmission,
        previousStatus,
        panVerification: verifications.pan?.status ?? null,
        gstVerification: verifications.gst?.status ?? null,
      },
    });
    await this.notifications.create({
      userId,
      organizationId: ctx.organizationId,
      title: resubmission ? 'KYC resubmitted' : 'KYC submitted',
      body: "Your business KYC is under review. We'll notify you as soon as the PetroTrade compliance team has verified it.",
      entityType: EntityOwnerType.CUSTOMER,
      entityId: ctx.customerProfileId,
      metadata: { type: 'KYC_SUBMITTED', resubmission },
    });

    return this.overview(userId);
  }

  /**
   * Human-readable steps that must be done before submission. Verification
   * rows hold only hashes, so the GSTIN comes from the organization, which
   * only ever receives accepted identifiers.
   */
  private verificationBlockers(
    { pan, gst }: Verifications,
    organizationGstin: string | null,
  ): string[] {
    const blockers: string[] = [];
    if (!verificationSatisfied(pan)) {
      blockers.push(
        pan?.status === KycVerificationStatus.FAILED
          ? 'PAN verification (failed)'
          : 'PAN verification',
      );
    }
    const gstCurrent =
      verificationSatisfied(gst) &&
      Boolean(organizationGstin) &&
      hashIdentifier('GST', organizationGstin!) === gst!.identifierHash;
    if (!gstCurrent) {
      blockers.push(
        gst?.status === KycVerificationStatus.FAILED
          ? 'GST verification (failed)'
          : 'GST verification',
      );
    }
    if (gstCurrent && hasPanGstMismatch(pan, gst, organizationGstin)) {
      blockers.push(PAN_GST_MISMATCH_MESSAGE);
    }
    return blockers;
  }

  private assertMatchesVerified(
    dto: SubmitCustomerKycDto,
    { pan, gst }: Verifications,
  ) {
    if (
      dto.pan &&
      pan &&
      hashIdentifier('PAN', dto.pan) !== pan.identifierHash
    ) {
      throw new BadRequestException(
        'The PAN entered has not been verified. Verify it before submitting.',
      );
    }
    if (
      dto.gstin &&
      gst &&
      hashIdentifier('GST', dto.gstin) !== gst.identifierHash
    ) {
      throw new BadRequestException(
        'The GSTIN entered has not been verified. Verify it before submitting.',
      );
    }
  }

  private checklist(input: {
    status: CustomerKycStatus;
    kycVerified: boolean;
    verifications: Verifications;
    missingDocuments: string[];
    rejectedDocuments: number;
  }): ChecklistItem[] {
    const { status, kycVerified, verifications } = input;
    const identity = (
      key: 'pan' | 'gst',
      label: string,
      row: KycVerification | null,
    ): ChecklistItem => {
      if (kycVerified || row?.status === KycVerificationStatus.VERIFIED) {
        return { key, label, state: 'done', detail: `${label} verified` };
      }
      if (!row) {
        return {
          key,
          label,
          state: 'todo',
          detail: `Enter and verify your ${label}`,
        };
      }
      const view = toVerificationView(row);
      if (row.status === KycVerificationStatus.FAILED) {
        return { key, label, state: 'attention', detail: view.message };
      }
      return {
        key,
        label,
        state: 'pending',
        detail:
          row.status === KycVerificationStatus.VERIFYING
            ? view.message
            : 'Will be verified by the compliance team',
      };
    };

    const documents: ChecklistItem = kycVerified
      ? {
          key: 'documents',
          label: 'Documents',
          state: 'done',
          detail: 'Documents verified',
        }
      : input.rejectedDocuments
        ? {
            key: 'documents',
            label: 'Documents',
            state: 'attention',
            detail: `${input.rejectedDocuments} document(s) need a new upload`,
          }
        : input.missingDocuments.length
          ? {
              key: 'documents',
              label: 'Documents',
              state: 'todo',
              detail: `Upload ${input.missingDocuments.join(', ')}`,
            }
          : {
              key: 'documents',
              label: 'Documents',
              state: 'done',
              detail: 'Required documents uploaded',
            };

    const reviewByStatus: Record<
      CustomerKycStatus,
      Omit<ChecklistItem, 'key' | 'label'>
    > = {
      NOT_SUBMITTED: { state: 'todo', detail: 'Submit your KYC for review' },
      SUBMITTED: { state: 'pending', detail: 'Admin review pending' },
      CHANGES_REQUESTED: { state: 'attention', detail: 'Changes requested' },
      REJECTED: { state: 'attention', detail: 'KYC needs correction' },
      APPROVED: { state: 'done', detail: 'KYC approved' },
    };
    const review = kycVerified
      ? reviewByStatus.APPROVED
      : reviewByStatus[status];

    return [
      identity('pan', 'PAN', verifications.pan),
      identity('gst', 'GST', verifications.gst),
      documents,
      { key: 'review', label: 'Admin review', ...review },
    ];
  }

  private async kycStatus(ctx: CustomerContext): Promise<CustomerKycStatus> {
    const profile = await this.prisma.customerProfile.findUnique({
      where: { id: ctx.customerProfileId },
      select: { metadata: true },
    });
    return readCustomerKycState(profile?.metadata).status;
  }

  private async isLocked(ctx: CustomerContext): Promise<boolean> {
    return LOCKED_KYC_STATUSES.has(await this.kycStatus(ctx));
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

  /** Newest confirmed file for the slot, including superseded ones, to chain versions. */
  private async latestStoredVersion(
    ctx: CustomerContext,
    slot: CustomerKycDocumentSlot,
  ) {
    const def = resolveCustomerKycSlot(slot);
    if (!def) return null;
    return this.prisma.document.findFirst({
      where: {
        organizationId: ctx.organizationId,
        ownerType: EntityOwnerType.CUSTOMER,
        ownerId: ctx.customerProfileId,
        category: def.category,
        AND: [
          {
            metadata: {
              path: ['purpose'],
              equals: CUSTOMER_KYC_DOCUMENT_PURPOSE,
            },
          },
          { metadata: { path: ['slot'], equals: slot } },
          { metadata: { path: ['r2Confirmed'], equals: true } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, version: true, rootDocumentId: true },
    });
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

  /**
   * Older versions leave the active set but keep their storage object, so the
   * admin audit trail can still open every version the customer sent.
   */
  private async supersedePrevious(
    ctx: CustomerContext,
    slot: CustomerKycDocumentSlot,
    keepId: string,
  ): Promise<string[]> {
    const rows = await this.findSlotDocuments(ctx, slot);
    const superseded: string[] = [];
    for (const row of rows) {
      if (row.id === keepId || row.deletedAt) continue;
      const canReplace =
        row.status === DocumentStatus.VERIFIED ||
        row.status === DocumentStatus.REJECTED;
      const status = canReplace
        ? DocumentStatus.REPLACED
        : DocumentStatus.ARCHIVED;
      this.state.assertTransition(row.status, status);
      await this.prisma.document.update({
        where: { id: row.id },
        data: { deletedAt: new Date(), status },
      });
      superseded.push(row.id);
    }
    return superseded;
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
