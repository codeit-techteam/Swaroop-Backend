import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentStatus,
  EntityOwnerType,
  KycVerificationStatus,
  Prisma,
  SellerOnboardingStatus,
  SellerStatus,
  VerificationStatus,
  type KycVerification,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { StorageService } from '../../../storage/storage.service.js';
import { NotificationService } from '../../notifications/notification.service.js';
import { DocumentStateService } from '../../documents/common/document-state.service.js';
import { contentDisposition } from '../../documents/services/documents-core.service.js';
import { lockCustomerKyc } from '../../customers/kyc/customer-kyc.lock.js';
import {
  hasPanGstMismatch,
  latestVerifications,
  PAN_GST_MISMATCH_MESSAGE,
  toVerificationView,
} from '../../kyc-verification/kyc-verification.records.js';
import {
  openChangeRequest,
  resolvedChangeRequest,
  type KycChangeRequest,
} from '../../documents/common/kyc-change-request.js';
import {
  CUSTOMER_KYC_DOCUMENT_PURPOSE,
  CUSTOMER_KYC_DOCUMENT_SLOTS,
  readCustomerKycState,
  withCustomerKycState,
  type CustomerKycState,
} from '../../customers/kyc/customer-kyc.slots.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import {
  SELLER_ONBOARDING_DOCUMENT_PURPOSE,
  SELLER_ONBOARDING_DOCUMENT_SLOTS,
  readJsonObject,
} from '../../sellers/onboarding/onboarding-documents.slots.js';
import { AdminAuditService } from '../common/admin-audit.service.js';
import { AdminSellersService } from '../sellers/admin-sellers.service.js';
import {
  ADMIN_KYC_STATUSES,
  type AdminKycApproveDto,
  type AdminKycEntityType,
  type AdminKycQueryDto,
  type AdminKycRejectDto,
  type AdminKycRequestChangesDto,
  type AdminKycStatus,
  type AdminKycVerificationFilter,
} from './admin-kyc.dto.js';

type LatestPair = { pan: KycVerification | null; gst: KycVerification | null };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function verificationState(
  row: KycVerification | null,
): AdminKycVerificationFilter {
  return row?.status ?? 'NOT_STARTED';
}

/** Upper bound per entity type for the merged seller + customer KYC queue. */
const MAX_ROWS_PER_TYPE = 2000;

const ACTIVE_DOCUMENT_STATUSES: DocumentStatus[] = [
  DocumentStatus.UPLOADED,
  DocumentStatus.UNDER_REVIEW,
  DocumentStatus.VERIFIED,
  DocumentStatus.REJECTED,
];

const PENDING_DOCUMENT_STATUSES = new Set<DocumentStatus>([
  DocumentStatus.UPLOADED,
  DocumentStatus.UNDER_REVIEW,
]);

type SlotDefinition = {
  slot: string;
  name: string;
  description: string;
  required: boolean;
};

const kycDocumentSelect = {
  id: true,
  ownerId: true,
  category: true,
  fileName: true,
  originalFileName: true,
  mimeType: true,
  fileSizeBytes: true,
  status: true,
  metadata: true,
  rejectionReason: true,
  verificationNotes: true,
  approvedAt: true,
  rejectedAt: true,
  createdAt: true,
} satisfies Prisma.DocumentSelect;

type KycDocumentRow = Prisma.DocumentGetPayload<{
  select: typeof kycDocumentSelect;
}>;

const sellerSelect = {
  id: true,
  userId: true,
  organizationId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      firstName: true,
      lastName: true,
      displayName: true,
      phone: true,
      email: true,
    },
  },
  organization: {
    select: {
      id: true,
      name: true,
      legalName: true,
      gstin: true,
      pan: true,
      verificationStatus: true,
      businessType: true,
      constitutionType: true,
    },
  },
  onboarding: {
    select: {
      status: true,
      submittedAt: true,
      reviewedAt: true,
      reviewNotes: true,
      rejectedReason: true,
      companyData: true,
      gstData: true,
      panData: true,
      bankData: true,
      addressData: true,
      updatedAt: true,
    },
  },
  verification: {
    select: { overallStatus: true, metadata: true, reviewedAt: true },
  },
} satisfies Prisma.SellerProfileSelect;

type SellerRow = Prisma.SellerProfileGetPayload<{
  select: typeof sellerSelect;
}>;

const customerSelect = {
  id: true,
  userId: true,
  organizationId: true,
  status: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  user: sellerSelect.user,
  organization: sellerSelect.organization,
} satisfies Prisma.CustomerProfileSelect;

type CustomerRow = Prisma.CustomerProfileGetPayload<{
  select: typeof customerSelect;
}>;

type BankSummary = {
  accountHolder: string | null;
  bankName: string | null;
  accountLast4: string | null;
  ifsc: string | null;
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function last4(value: unknown): string | null {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function contactName(user: SellerRow['user']): string | null {
  return (
    str(user.displayName) ??
    ([user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null)
  );
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** Signed links for audit/version views are short-lived; the UI re-requests on click. */
const VERSION_SIGNED_URL_SECONDS = 300;

/** Audit fields safe to show in the admin timeline (no storage keys, no raw identifiers). */
const AUDIT_DETAIL_KEYS = [
  'slot',
  'version',
  'identifier',
  'type',
  'status',
  'failureCode',
  'reason',
  'kycStatus',
  'resubmission',
  'fileName',
  'previousStatus',
  'provider',
  'source',
] as const;

type AuditDetailValue = string | number | boolean | null;

function auditDetails(...sources: unknown[]): Record<string, AuditDetailValue> {
  const details: Record<string, AuditDetailValue> = {};
  for (const source of sources) {
    const record = readJsonObject(source);
    for (const key of AUDIT_DETAIL_KEYS) {
      const value = record[key];
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        details[key] = value;
      }
    }
  }
  return details;
}

@Injectable()
export class AdminKycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly notifications: NotificationService,
    private readonly documentState: DocumentStateService,
    private readonly sellers: AdminSellersService,
    private readonly storage: StorageService,
  ) {}

  async list(query: AdminKycQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const rows = await this.allRows(query.entityType, query.search?.trim());
    const filtered = rows.filter(
      (row) =>
        (!query.status || row.kycStatus === query.status) &&
        (!query.panStatus || row.verification.pan === query.panStatus) &&
        (!query.gstStatus || row.verification.gst === query.gstStatus) &&
        (!query.documents ||
          (query.documents === 'PENDING'
            ? row.documents.pending > 0
            : query.documents === 'MISSING'
              ? row.documents.missing.length > 0
              : row.documents.rejected > 0)) &&
        (!query.mismatch || row.verification.mismatch),
    );
    filtered.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    return {
      items: filtered.slice(skip, skip + take),
      meta: paginationMeta(page, limit, filtered.length),
    };
  }

  /** Platform-wide KYC counters for the admin dashboard, computed from live records. */
  async metrics() {
    const rows = await this.allRows();
    const byStatus = (entityType?: AdminKycEntityType) =>
      Object.fromEntries(
        ADMIN_KYC_STATUSES.map((status) => [
          status,
          rows.filter(
            (row) =>
              row.kycStatus === status &&
              (!entityType || row.entityType === entityType),
          ).length,
        ]),
      ) as Record<AdminKycStatus, number>;
    const verificationCounts = (key: 'pan' | 'gst') => ({
      verified: rows.filter((row) => row.verification[key] === 'VERIFIED')
        .length,
      failed: rows.filter((row) => row.verification[key] === 'FAILED').length,
      manualReview: rows.filter(
        (row) => row.verification[key] === 'MANUAL_REVIEW',
      ).length,
      notStarted: rows.filter((row) => row.verification[key] === 'NOT_STARTED')
        .length,
    });
    return {
      totals: {
        customers: rows.filter((row) => row.entityType === 'CUSTOMER').length,
        sellers: rows.filter((row) => row.entityType === 'SELLER').length,
      },
      status: byStatus(),
      customers: byStatus('CUSTOMER'),
      sellers: byStatus('SELLER'),
      pan: verificationCounts('pan'),
      gst: verificationCounts('gst'),
      mismatches: rows.filter((row) => row.verification.mismatch).length,
      documentsPending: rows.filter((row) => row.documents.pending > 0).length,
      documentsMissing: rows.filter(
        (row) =>
          row.kycStatus !== 'APPROVED' && row.documents.missing.length > 0,
      ).length,
      generatedAt: new Date().toISOString(),
    };
  }

  private async allRows(entityType?: AdminKycEntityType, search?: string) {
    return [
      ...(!entityType || entityType === 'SELLER'
        ? await this.sellerRows(search)
        : []),
      ...(!entityType || entityType === 'CUSTOMER'
        ? await this.customerRows(search)
        : []),
    ];
  }

  async detail(entityType: AdminKycEntityType, id: string) {
    if (entityType === 'SELLER') {
      const seller = await this.prisma.sellerProfile.findFirst({
        where: { id, deletedAt: null },
        select: sellerSelect,
      });
      if (!seller) throw new NotFoundException('Seller not found');
      const [docs, banks, history, latest, verificationHistory] =
        await Promise.all([
          this.kycDocuments('SELLER', [id]),
          this.bankSummaries([seller.organizationId]),
          this.documentHistory('SELLER', id),
          latestVerifications(this.prisma, EntityOwnerType.SELLER, id),
          this.verificationHistory(EntityOwnerType.SELLER, id),
        ]);
      const ownDocs = docs.get(id) ?? [];
      const verifications = new Map([[id, latest]]);
      const row = this.toSellerRow(seller, ownDocs, banks, verifications);
      const onboarding = seller.onboarding;
      const address = readJsonObject(onboarding?.addressData);
      const gst = latest.gst ? toVerificationView(latest.gst).details : {};
      const onboardingAddress =
        [
          str(address.line1),
          str(address.line2),
          str(address.city),
          str(address.state),
          str(address.pincode),
        ]
          .filter(Boolean)
          .join(', ') || null;
      const legalName =
        gst.legalName ??
        str(readJsonObject(onboarding?.companyData).legalName) ??
        seller.organization.legalName;
      return {
        ...row,
        documentHistory: this.groupHistory(
          SELLER_ONBOARDING_DOCUMENT_SLOTS,
          history,
        ),
        slots: this.slotViews(SELLER_ONBOARDING_DOCUMENT_SLOTS, ownDocs),
        blockers: [
          ...this.approvalBlockers(SELLER_ONBOARDING_DOCUMENT_SLOTS, ownDocs),
          ...this.verificationBlockers(latest, row.organization.gstin),
        ],
        warnings: this.verificationWarnings(latest),
        details: {
          legalName,
          address: gst.address ?? onboardingAddress,
        },
        business: {
          name: seller.organization.name,
          legalName,
          tradeName: gst.tradeName ?? null,
          businessType:
            seller.organization.businessType ?? gst.taxpayerType ?? null,
          constitution:
            seller.organization.constitutionType ?? gst.constitution ?? null,
          address: gst.address ?? onboardingAddress,
          state: gst.state ?? str(address.state),
          pincode: gst.pincode ?? str(address.pincode),
        },
        verifications: {
          pan: latest.pan ? toVerificationView(latest.pan) : null,
          gst: latest.gst ? toVerificationView(latest.gst) : null,
          mismatch: hasPanGstMismatch(
            latest.pan,
            latest.gst,
            row.organization.gstin,
          ),
          history: verificationHistory.map(toVerificationView),
        },
      };
    }

    const customer = await this.prisma.customerProfile.findFirst({
      where: { id, deletedAt: null },
      select: customerSelect,
    });
    if (!customer) throw new NotFoundException('Customer not found');
    const [docs, banks, latest, verificationHistory, documentHistory] =
      await Promise.all([
        this.kycDocuments('CUSTOMER', [id]),
        this.bankSummaries([customer.organizationId]),
        latestVerifications(this.prisma, EntityOwnerType.CUSTOMER, id),
        this.verificationHistory(EntityOwnerType.CUSTOMER, id),
        this.documentHistory('CUSTOMER', id),
      ]);
    const ownDocs = docs.get(id) ?? [];
    const gst = latest.gst ? toVerificationView(latest.gst).details : {};
    const org = customer.organization;
    return {
      ...this.toCustomerRow(customer, ownDocs, banks, new Map([[id, latest]])),
      slots: this.slotViews(CUSTOMER_KYC_DOCUMENT_SLOTS, ownDocs),
      blockers: [
        ...this.approvalBlockers(CUSTOMER_KYC_DOCUMENT_SLOTS, ownDocs),
        ...this.verificationBlockers(latest, org.gstin),
      ],
      warnings: this.verificationWarnings(latest),
      details: {
        legalName: gst.legalName ?? org.legalName,
        address: gst.address ?? null,
      },
      customer: {
        id: customer.id,
        userId: customer.userId,
        name: contactName(customer.user),
        email: customer.user.email,
        phone: customer.user.phone,
        status: customer.status,
      },
      business: {
        name: org.name,
        legalName: gst.legalName ?? org.legalName,
        tradeName: gst.tradeName ?? null,
        businessType: org.businessType ?? gst.taxpayerType ?? null,
        constitution: org.constitutionType ?? gst.constitution ?? null,
        address: gst.address ?? null,
        state: gst.state ?? null,
        pincode: gst.pincode ?? null,
      },
      verifications: {
        pan: latest.pan ? toVerificationView(latest.pan) : null,
        gst: latest.gst ? toVerificationView(latest.gst) : null,
        mismatch: hasPanGstMismatch(latest.pan, latest.gst, org.gstin),
        history: verificationHistory.map(toVerificationView),
      },
      documentHistory: this.groupHistory(
        CUSTOMER_KYC_DOCUMENT_SLOTS,
        documentHistory,
      ),
    };
  }

  /** Every confirmed version of every KYC file, superseded ones included. */
  async auditTrail(entityType: AdminKycEntityType, id: string) {
    const owner =
      entityType === 'CUSTOMER'
        ? await this.prisma.customerProfile.findFirst({
            where: { id, deletedAt: null },
            select: { userId: true },
          })
        : await this.prisma.sellerProfile.findFirst({
            where: { id, deletedAt: null },
            select: { userId: true },
          });
    if (!owner) {
      throw new NotFoundException(
        entityType === 'CUSTOMER' ? 'Customer not found' : 'Seller not found',
      );
    }
    const ownerType =
      entityType === 'CUSTOMER'
        ? EntityOwnerType.CUSTOMER
        : EntityOwnerType.SELLER;
    const documentIds = (
      await this.prisma.document.findMany({
        where: {
          ownerType,
          ownerId: id,
          metadata: {
            path: ['purpose'],
            equals:
              entityType === 'CUSTOMER'
                ? CUSTOMER_KYC_DOCUMENT_PURPOSE
                : SELLER_ONBOARDING_DOCUMENT_PURPOSE,
          },
        },
        select: { id: true },
      })
    ).map((doc) => doc.id);

    const logs = await this.prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: ownerType, entityId: id },
          ...(documentIds.length
            ? [
                {
                  entityType: EntityOwnerType.DOCUMENT,
                  entityId: { in: documentIds },
                },
              ]
            : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        action: true,
        actorUserId: true,
        entityType: true,
        entityId: true,
        metadata: true,
        previousData: true,
        newData: true,
        createdAt: true,
        actor: {
          select: {
            firstName: true,
            lastName: true,
            displayName: true,
            email: true,
          },
        },
      },
    });

    return logs.map((log) => {
      const role = !log.actorUserId
        ? 'SYSTEM'
        : log.actorUserId === owner.userId
          ? entityType
          : (str(readJsonObject(log.metadata).actorRole) ?? 'ADMIN');
      return {
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        actor: {
          id: log.actorUserId,
          name: log.actor
            ? (contactName({ ...log.actor, phone: null }) ?? log.actor.email)
            : null,
          role,
        },
        details: auditDetails(log.previousData, log.metadata, log.newData),
        createdAt: log.createdAt.toISOString(),
      };
    });
  }

  /** Signed URL for any KYC file version, including ones the customer has since replaced. */
  async downloadVersion(
    entityType: AdminKycEntityType,
    id: string,
    documentId: string,
    actorUserId: string,
    disposition: 'inline' | 'attachment',
  ) {
    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        ownerType:
          entityType === 'CUSTOMER'
            ? EntityOwnerType.CUSTOMER
            : EntityOwnerType.SELLER,
        ownerId: id,
        metadata: {
          path: ['purpose'],
          equals:
            entityType === 'CUSTOMER'
              ? CUSTOMER_KYC_DOCUMENT_PURPOSE
              : SELLER_ONBOARDING_DOCUMENT_PURPOSE,
        },
      },
    });
    if (!doc || readJsonObject(doc.metadata).r2Confirmed !== true) {
      throw new NotFoundException('Document version not found');
    }
    if (!(await this.storage.exists(doc.storageKey))) {
      throw new NotFoundException(
        'The file for this document version is no longer in storage.',
      );
    }
    const fileName = doc.originalFileName ?? doc.fileName;
    const url = await this.storage.getSignedUrl({
      key: doc.storageKey,
      operation: 'get',
      expiresInSeconds: VERSION_SIGNED_URL_SECONDS,
      responseContentDisposition: contentDisposition(disposition, fileName),
      responseContentType: doc.mimeType ?? undefined,
    });
    await this.audit.log({
      action:
        disposition === 'inline' ? 'DOCUMENT_PREVIEWED' : 'DOCUMENT_DOWNLOADED',
      actorUserId,
      organizationId: doc.organizationId ?? undefined,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: doc.id,
      metadata: { actorRole: 'ADMIN', version: doc.version },
    });
    return {
      id: doc.id,
      url,
      fileName,
      mimeType: doc.mimeType,
      expiresInSeconds: VERSION_SIGNED_URL_SECONDS,
    };
  }

  async approve(
    entityType: AdminKycEntityType,
    id: string,
    actorUserId: string,
    dto: AdminKycApproveDto,
  ) {
    if (entityType === 'SELLER') {
      await this.approveSeller(id, actorUserId, dto);
      return this.detail(entityType, id);
    }

    const customer = await this.requireCustomer(id);
    const initial = readCustomerKycState(customer.metadata);
    this.assertCanApprove(initial.status);
    const [docs, verifications, organization] = await Promise.all([
      this.kycDocuments('CUSTOMER', [id]).then((map) => map.get(id) ?? []),
      latestVerifications(this.prisma, EntityOwnerType.CUSTOMER, id),
      this.prisma.organization.findUniqueOrThrow({
        where: { id: customer.organizationId },
        select: { gstin: true },
      }),
    ]);
    const blockers = [
      ...this.approvalBlockers(CUSTOMER_KYC_DOCUMENT_SLOTS, docs),
      ...this.verificationBlockers(verifications, organization.gstin),
    ];
    if (blockers.length) {
      throw new BadRequestException(
        `KYC cannot be approved yet: ${blockers.join(', ')}`,
      );
    }
    const pendingIds = this.currentDocuments(CUSTOMER_KYC_DOCUMENT_SLOTS, docs)
      .filter((doc) => PENDING_DOCUMENT_STATUSES.has(doc.status))
      .map((doc) => doc.id);
    const manualIds = [verifications.pan, verifications.gst]
      .filter(
        (row): row is KycVerification =>
          row?.status === KycVerificationStatus.MANUAL_REVIEW,
      )
      .map((row) => row.id);

    const now = new Date();
    const kyc = await this.prisma.$transaction(async (tx) => {
      const locked = await lockCustomerKyc(tx, id);
      this.assertCanApprove(locked.kyc.status, true);
      if (manualIds.length) {
        // Approving with a manual-review verification is the compliance team
        // confirming the PAN/GSTIN against the uploaded documents.
        await tx.kycVerification.updateMany({
          where: {
            id: { in: manualIds },
            status: KycVerificationStatus.MANUAL_REVIEW,
          },
          data: {
            status: KycVerificationStatus.VERIFIED,
            verifiedAt: now,
            reviewedById: actorUserId,
            reviewedAt: now,
          },
        });
      }
      if (pendingIds.length) {
        await tx.document.updateMany({
          where: { id: { in: pendingIds } },
          data: {
            status: DocumentStatus.VERIFIED,
            approvedById: actorUserId,
            approvedAt: now,
            rejectedById: null,
            rejectedAt: null,
            rejectionReason: null,
            verificationNotes: 'Verified with KYC approval',
          },
        });
      }
      await tx.customerProfile.update({
        where: { id },
        data: {
          metadata: withCustomerKycState(locked.metadata, {
            status: 'APPROVED',
            reviewedAt: now.toISOString(),
            reviewedById: actorUserId,
            reviewNotes: dto.notes ?? null,
            rejectedReason: null,
            changeRequest: resolvedChangeRequest(locked.kyc.changeRequest, now),
          }) as Prisma.InputJsonValue,
        },
      });
      await tx.organization.update({
        where: { id: customer.organizationId },
        data: {
          verificationStatus: VerificationStatus.APPROVED,
          verifiedAt: now,
        },
      });
      return locked.kyc;
    });

    await this.audit.log({
      action: 'CUSTOMER_KYC_APPROVED',
      actorUserId,
      organizationId: customer.organizationId,
      entityType: EntityOwnerType.CUSTOMER,
      entityId: id,
      previousData: { kycStatus: kyc.status },
      newData: {
        kycStatus: 'APPROVED',
        verifiedDocumentIds: pendingIds,
        manuallyVerifiedIds: manualIds,
      },
      metadata: { actorRole: 'ADMIN' },
    });
    await this.notifications.create({
      userId: customer.userId,
      organizationId: customer.organizationId,
      title: 'KYC approved',
      body: 'Your business KYC has been verified. You now have full access to PetroTrade.',
      entityType: EntityOwnerType.CUSTOMER,
      entityId: id,
      metadata: { type: 'KYC_APPROVED' },
    });

    return this.detail(entityType, id);
  }

  async reject(
    entityType: AdminKycEntityType,
    id: string,
    actorUserId: string,
    dto: AdminKycRejectDto,
  ) {
    if (entityType === 'SELLER') {
      await this.sellers.reject(id, actorUserId, { reason: dto.reason });
      return this.detail(entityType, id);
    }

    const customer = await this.requireCustomer(id);
    if (readCustomerKycState(customer.metadata).status === 'REJECTED') {
      throw new BadRequestException('Customer KYC is already rejected');
    }
    const now = new Date();
    const kyc = await this.prisma.$transaction(async (tx) => {
      const locked = await lockCustomerKyc(tx, id);
      if (locked.kyc.status === 'REJECTED') {
        throw new ConflictException(
          'This KYC was just rejected by another reviewer. Refresh to see the latest status.',
        );
      }
      await tx.customerProfile.update({
        where: { id },
        data: {
          metadata: withCustomerKycState(locked.metadata, {
            status: 'REJECTED',
            reviewedAt: now.toISOString(),
            reviewedById: actorUserId,
            reviewNotes: dto.reason,
            rejectedReason: dto.reason,
            changeRequest: resolvedChangeRequest(locked.kyc.changeRequest, now),
          }) as Prisma.InputJsonValue,
        },
      });
      await tx.organization.update({
        where: { id: customer.organizationId },
        data: { verificationStatus: VerificationStatus.REJECTED },
      });
      return locked.kyc;
    });

    await this.audit.log({
      action: 'CUSTOMER_KYC_REJECTED',
      actorUserId,
      organizationId: customer.organizationId,
      entityType: EntityOwnerType.CUSTOMER,
      entityId: id,
      previousData: { kycStatus: kyc.status },
      newData: { kycStatus: 'REJECTED', reason: dto.reason },
      metadata: { actorRole: 'ADMIN' },
    });
    await this.notifications.create({
      userId: customer.userId,
      organizationId: customer.organizationId,
      title: 'KYC verification requires changes',
      body: `${dto.reason} Update your documents and resubmit.`,
      entityType: EntityOwnerType.CUSTOMER,
      entityId: id,
      metadata: { type: 'KYC_REJECTED' },
    });

    return this.detail(entityType, id);
  }

  async requestChanges(
    entityType: AdminKycEntityType,
    id: string,
    actorUserId: string,
    dto: AdminKycRequestChangesDto,
  ) {
    if (entityType === 'SELLER') {
      await this.sellers.requestChanges(id, actorUserId, dto);
      return this.detail(entityType, id);
    }

    const customer = await this.requireCustomer(id);
    if (readCustomerKycState(customer.metadata).status === 'APPROVED') {
      throw new BadRequestException(
        'Customer KYC is already approved and cannot be sent back',
      );
    }
    const reason = dto.reason.trim();
    const documentIds = [...new Set(dto.documentIds ?? [])];
    const docs = (await this.kycDocuments('CUSTOMER', [id])).get(id) ?? [];
    const selected = docs.filter((doc) => documentIds.includes(doc.id));
    if (selected.length !== documentIds.length) {
      throw new BadRequestException(
        "Some selected documents are not part of this customer's KYC",
      );
    }
    for (const doc of selected) {
      if (doc.status === DocumentStatus.VERIFIED) {
        throw new BadRequestException(
          `${this.slotLabel(doc) ?? doc.fileName} is already verified and cannot be sent back`,
        );
      }
      this.documentState.assertTransition(doc.status, DocumentStatus.REJECTED);
    }

    const now = new Date();
    const changeRequest: KycChangeRequest = {
      reason,
      documentIds,
      slots: selected
        .map((doc) => this.slotOf(doc))
        .filter((slot): slot is string => Boolean(slot)),
      requestedAt: now.toISOString(),
      requestedById: actorUserId,
      resolvedAt: null,
    };

    const kyc = await this.prisma.$transaction(async (tx) => {
      const locked = await lockCustomerKyc(tx, id);
      if (locked.kyc.status === 'APPROVED') {
        throw new ConflictException(
          'This KYC was just approved by another reviewer. Refresh to see the latest status.',
        );
      }
      for (const doc of selected) {
        if (doc.status === DocumentStatus.REJECTED) continue;
        await tx.document.update({
          where: { id: doc.id },
          data: {
            status: DocumentStatus.REJECTED,
            rejectionReason: reason,
            verificationNotes: reason,
            rejectedById: actorUserId,
            rejectedAt: now,
            approvedById: null,
            approvedAt: null,
          },
        });
      }
      await tx.customerProfile.update({
        where: { id },
        data: {
          metadata: withCustomerKycState(locked.metadata, {
            status: 'CHANGES_REQUESTED',
            reviewedAt: now.toISOString(),
            reviewedById: actorUserId,
            reviewNotes: reason,
            rejectedReason: null,
            changeRequest,
          }) as Prisma.InputJsonValue,
        },
      });
      await tx.organization.update({
        where: { id: customer.organizationId },
        data: { verificationStatus: VerificationStatus.PENDING },
      });
      return locked.kyc;
    });

    await this.audit.log({
      action: 'CUSTOMER_KYC_CHANGES_REQUESTED',
      actorUserId,
      organizationId: customer.organizationId,
      entityType: EntityOwnerType.CUSTOMER,
      entityId: id,
      previousData: { kycStatus: kyc.status },
      newData: { kycStatus: 'CHANGES_REQUESTED', reason, documentIds },
      metadata: { actorRole: 'ADMIN' },
    });

    const names = selected
      .map((doc) => this.slotLabel(doc))
      .filter((name): name is string => Boolean(name));
    await this.notifications.create({
      userId: customer.userId,
      organizationId: customer.organizationId,
      title: 'Action required: update your KYC',
      body: names.length
        ? `Please re-upload ${names.join(', ')}. ${reason}`
        : reason,
      entityType: EntityOwnerType.CUSTOMER,
      entityId: id,
      metadata: {
        type: 'KYC_CHANGES_REQUESTED',
        slots: changeRequest.slots,
        documentIds,
      },
    });

    return this.detail(entityType, id);
  }

  /** Only a KYC the customer has submitted (and not withdrawn by a decision) can be approved. */
  private assertCanApprove(status: CustomerKycState['status'], locked = false) {
    if (status === 'SUBMITTED') return;
    if (locked) {
      throw new ConflictException(
        status === 'APPROVED'
          ? 'This KYC was just approved by another reviewer.'
          : 'This KYC changed while you were reviewing it. Refresh to see the latest status.',
      );
    }
    if (status === 'APPROVED') {
      throw new BadRequestException('Customer KYC is already approved');
    }
    throw new BadRequestException(
      'Only KYC submitted for review can be approved. Wait for the customer to submit or resubmit.',
    );
  }

  /**
   * Seller approval goes through AdminSellersService; PAN/GST verification is
   * enforced first, and manual-review results are confirmed by the approval.
   */
  private async approveSeller(
    id: string,
    actorUserId: string,
    dto: AdminKycApproveDto,
  ) {
    const seller = await this.prisma.sellerProfile.findFirst({
      where: { id, deletedAt: null },
      select: {
        organization: { select: { gstin: true } },
        onboarding: { select: { gstData: true } },
      },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    const latest = await latestVerifications(
      this.prisma,
      EntityOwnerType.SELLER,
      id,
    );
    const gstin =
      seller.organization.gstin ??
      str(readJsonObject(seller.onboarding?.gstData).gstin);
    const blockers = this.verificationBlockers(latest, gstin);
    if (blockers.length) {
      throw new BadRequestException(
        `KYC cannot be approved yet: ${blockers.join(', ')}`,
      );
    }

    await this.sellers.approve(id, actorUserId, { notes: dto.notes });

    const now = new Date();
    const manualIds = [latest.pan, latest.gst]
      .filter(
        (row): row is KycVerification =>
          row?.status === KycVerificationStatus.MANUAL_REVIEW,
      )
      .map((row) => row.id);
    await this.prisma.$transaction(async (tx) => {
      if (manualIds.length) {
        await tx.kycVerification.updateMany({
          where: {
            id: { in: manualIds },
            status: KycVerificationStatus.MANUAL_REVIEW,
          },
          data: {
            status: KycVerificationStatus.VERIFIED,
            verifiedAt: now,
            reviewedById: actorUserId,
            reviewedAt: now,
          },
        });
      }
      if (latest.pan || latest.gst) {
        await tx.sellerVerification.updateMany({
          where: { sellerProfileId: id },
          data: {
            ...(latest.pan ? { panVerified: true } : {}),
            ...(latest.gst ? { gstVerified: true } : {}),
          },
        });
      }
    });
    if (manualIds.length) {
      await this.audit.log({
        action: 'SELLER_KYC_IDENTITY_MANUALLY_VERIFIED',
        actorUserId,
        entityType: EntityOwnerType.SELLER,
        entityId: id,
        newData: { manuallyVerifiedIds: manualIds },
        metadata: { actorRole: 'ADMIN' },
      });
    }
  }

  private verificationHistory(ownerType: EntityOwnerType, ownerId: string) {
    return this.prisma.kycVerification.findMany({
      where: { ownerType, ownerId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  private verificationBlockers(
    verifications: LatestPair,
    gstin?: string | null,
  ): string[] {
    const blockers: string[] = [];
    if (hasPanGstMismatch(verifications.pan, verifications.gst, gstin)) {
      blockers.push(PAN_GST_MISMATCH_MESSAGE);
    }
    for (const [label, row] of [
      ['PAN', verifications.pan],
      ['GST', verifications.gst],
    ] as const) {
      if (row?.status === KycVerificationStatus.FAILED) {
        blockers.push(`${label} verification failed`);
      }
      if (row?.status === KycVerificationStatus.VERIFYING) {
        blockers.push(`${label} verification in progress`);
      }
    }
    return blockers;
  }

  /** Non-blocking notes the reviewer must acknowledge before approving. */
  private verificationWarnings(verifications: LatestPair): string[] {
    const warnings: string[] = [];
    for (const [label, row, doc] of [
      ['PAN', verifications.pan, 'PAN card'],
      ['GSTIN', verifications.gst, 'GST certificate'],
    ] as const) {
      if (!row) {
        warnings.push(
          `${label} was not checked by the verification service (submitted before automatic verification). Check it against the ${doc}.`,
        );
      } else if (row.status === KycVerificationStatus.MANUAL_REVIEW) {
        warnings.push(
          `${label} ${row.identifierMasked} needs manual verification. Approving confirms you checked it against the ${doc}.`,
        );
      }
    }
    return warnings;
  }

  private async documentHistory(
    entityType: AdminKycEntityType,
    ownerId: string,
  ) {
    const rows = await this.prisma.document.findMany({
      where: {
        ownerType:
          entityType === 'SELLER'
            ? EntityOwnerType.SELLER
            : EntityOwnerType.CUSTOMER,
        ownerId,
        metadata: {
          path: ['purpose'],
          equals:
            entityType === 'SELLER'
              ? SELLER_ONBOARDING_DOCUMENT_PURPOSE
              : CUSTOMER_KYC_DOCUMENT_PURPOSE,
        },
      },
      select: {
        id: true,
        version: true,
        status: true,
        fileName: true,
        originalFileName: true,
        mimeType: true,
        fileSizeBytes: true,
        rejectionReason: true,
        metadata: true,
        createdAt: true,
        deletedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.filter(
      (row) => readJsonObject(row.metadata).r2Confirmed === true,
    );
  }

  private groupHistory(
    slots: readonly SlotDefinition[],
    rows: Awaited<ReturnType<AdminKycService['documentHistory']>>,
  ) {
    return slots.map((def) => ({
      slot: def.slot,
      name: def.name,
      versions: rows
        .filter((row) => readJsonObject(row.metadata).slot === def.slot)
        .map((row) => ({
          id: row.id,
          version: row.version,
          status: row.status,
          fileName: row.originalFileName ?? row.fileName,
          mimeType: row.mimeType,
          fileSizeBytes: row.fileSizeBytes?.toString() ?? null,
          rejectionReason: row.rejectionReason,
          uploadSource: str(readJsonObject(row.metadata).uploadSource),
          uploadedAt: row.createdAt.toISOString(),
          current: row.deletedAt === null,
        })),
    }));
  }

  private async requireCustomer(id: string) {
    const customer = await this.prisma.customerProfile.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        metadata: true,
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  private searchWhere(search?: string) {
    if (!search) return undefined;
    const contains = { contains: search, mode: Prisma.QueryMode.insensitive };
    return [
      ...(UUID_PATTERN.test(search) ? [{ id: search }] : []),
      { organization: { name: contains } },
      { organization: { legalName: contains } },
      { organization: { gstin: contains } },
      { organization: { pan: contains } },
      { user: { email: contains } },
      { user: { phone: contains } },
      { user: { displayName: contains } },
    ];
  }

  /** Latest PAN and GST attempt per owner, in one query. */
  private async latestVerificationMap(
    ownerType: EntityOwnerType,
    ownerIds: string[],
  ): Promise<Map<string, LatestPair>> {
    const result = new Map<string, LatestPair>();
    if (!ownerIds.length) return result;
    const rows = await this.prisma.kycVerification.findMany({
      where: { ownerType, ownerId: { in: ownerIds } },
      orderBy: { createdAt: 'desc' },
      distinct: ['ownerId', 'type'],
    });
    for (const row of rows) {
      const pair = result.get(row.ownerId) ?? { pan: null, gst: null };
      if (row.type === 'PAN') pair.pan = row;
      else pair.gst = row;
      result.set(row.ownerId, pair);
    }
    return result;
  }

  private async sellerRows(search?: string) {
    const sellers = await this.prisma.sellerProfile.findMany({
      where: { deletedAt: null, OR: this.searchWhere(search) },
      select: sellerSelect,
      orderBy: { updatedAt: 'desc' },
      take: MAX_ROWS_PER_TYPE,
    });
    const [docs, banks, verifications] = await Promise.all([
      this.kycDocuments(
        'SELLER',
        sellers.map((s) => s.id),
      ),
      this.bankSummaries(sellers.map((s) => s.organizationId)),
      this.latestVerificationMap(
        EntityOwnerType.SELLER,
        sellers.map((s) => s.id),
      ),
    ]);
    return sellers.map((seller) =>
      this.toSellerRow(seller, docs.get(seller.id) ?? [], banks, verifications),
    );
  }

  private async customerRows(search?: string) {
    const customers = await this.prisma.customerProfile.findMany({
      where: { deletedAt: null, OR: this.searchWhere(search) },
      select: customerSelect,
      orderBy: { updatedAt: 'desc' },
      take: MAX_ROWS_PER_TYPE,
    });
    const [docs, banks, verifications] = await Promise.all([
      this.kycDocuments(
        'CUSTOMER',
        customers.map((c) => c.id),
      ),
      this.bankSummaries(customers.map((c) => c.organizationId)),
      this.latestVerificationMap(
        EntityOwnerType.CUSTOMER,
        customers.map((c) => c.id),
      ),
    ]);
    return customers.map((customer) =>
      this.toCustomerRow(
        customer,
        docs.get(customer.id) ?? [],
        banks,
        verifications,
      ),
    );
  }

  private toSellerRow(
    seller: SellerRow,
    docs: KycDocumentRow[],
    banks: Map<string, BankSummary>,
    verifications: Map<string, LatestPair>,
  ) {
    const onboarding = seller.onboarding;
    const reopened =
      onboarding?.status === SellerOnboardingStatus.IN_PROGRESS ||
      onboarding?.status === SellerOnboardingStatus.DRAFT;
    const changeRequest = reopened
      ? openChangeRequest(
          readJsonObject(seller.verification?.metadata).changeRequest,
        )
      : null;
    const bankData = readJsonObject(onboarding?.bankData);
    const onboardingBank: BankSummary | null =
      str(bankData.accountNumber) || str(bankData.ifsc)
        ? {
            accountHolder: str(bankData.accountHolder),
            bankName: str(bankData.bankName),
            accountLast4: last4(bankData.accountNumber),
            ifsc: str(bankData.ifsc),
          }
        : null;
    const rejected =
      seller.status === SellerStatus.REJECTED ||
      onboarding?.status === SellerOnboardingStatus.REJECTED;

    return this.baseRow({
      entityType: 'SELLER',
      entityId: seller.id,
      entityStatus: seller.status,
      kycStatus: this.sellerKycStatus(seller, Boolean(changeRequest)),
      user: seller.user,
      organization: {
        ...seller.organization,
        gstin:
          seller.organization.gstin ??
          str(readJsonObject(onboarding?.gstData).gstin),
        pan:
          seller.organization.pan ??
          str(readJsonObject(onboarding?.panData).pan),
      },
      submittedAt: iso(onboarding?.submittedAt),
      reviewedAt: iso(onboarding?.reviewedAt),
      reviewNotes: onboarding?.reviewNotes ?? null,
      rejectedReason: rejected
        ? (onboarding?.rejectedReason ?? onboarding?.reviewNotes ?? null)
        : null,
      changeRequest,
      bank: onboardingBank ?? banks.get(seller.organizationId) ?? null,
      slots: SELLER_ONBOARDING_DOCUMENT_SLOTS,
      docs,
      verifications: verifications.get(seller.id),
      createdAt: seller.createdAt,
      updatedAt: onboarding?.updatedAt ?? seller.updatedAt,
    });
  }

  private toCustomerRow(
    customer: CustomerRow,
    docs: KycDocumentRow[],
    banks: Map<string, BankSummary>,
    verifications: Map<string, LatestPair>,
  ) {
    const kyc = readCustomerKycState(customer.metadata);
    return this.baseRow({
      entityType: 'CUSTOMER',
      entityId: customer.id,
      entityStatus: customer.status,
      kycStatus: this.customerKycStatus(
        kyc,
        customer.organization.verificationStatus,
      ),
      user: customer.user,
      organization: customer.organization,
      submittedAt: kyc.submittedAt,
      reviewedAt: kyc.reviewedAt,
      reviewNotes: kyc.reviewNotes,
      rejectedReason: kyc.status === 'REJECTED' ? kyc.rejectedReason : null,
      changeRequest:
        kyc.status === 'CHANGES_REQUESTED'
          ? openChangeRequest(kyc.changeRequest)
          : null,
      bank: banks.get(customer.organizationId) ?? null,
      slots: CUSTOMER_KYC_DOCUMENT_SLOTS,
      docs,
      verifications: verifications.get(customer.id),
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    });
  }

  private baseRow(input: {
    entityType: AdminKycEntityType;
    entityId: string;
    entityStatus: string;
    kycStatus: AdminKycStatus;
    user: SellerRow['user'];
    organization: SellerRow['organization'];
    submittedAt: string | null;
    reviewedAt: string | null;
    reviewNotes: string | null;
    rejectedReason: string | null;
    changeRequest: KycChangeRequest | null;
    bank: BankSummary | null;
    slots: readonly SlotDefinition[];
    docs: KycDocumentRow[];
    verifications?: LatestPair;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const current = this.currentDocuments(input.slots, input.docs);
    const latestDoc = input.docs[0];
    const pan = input.verifications?.pan ?? null;
    const gst = input.verifications?.gst ?? null;
    const latestAttempt = [pan, gst]
      .filter((row): row is KycVerification => Boolean(row))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const lastActivity = [
      input.submittedAt,
      input.reviewedAt,
      iso(input.updatedAt),
      iso(latestDoc?.createdAt),
      iso(latestAttempt?.updatedAt),
    ]
      .filter((value): value is string => Boolean(value))
      .sort()
      .pop();
    return {
      id: `${input.entityType.toLowerCase()}:${input.entityId}`,
      entityType: input.entityType,
      entityId: input.entityId,
      entityStatus: input.entityStatus,
      kycStatus: input.kycStatus,
      organization: {
        id: input.organization.id,
        name: input.organization.name,
        legalName: input.organization.legalName,
        gstin: input.organization.gstin,
        pan: input.organization.pan,
      },
      contact: {
        name: contactName(input.user),
        phone: input.user.phone,
        email: input.user.email,
      },
      submittedAt: input.submittedAt,
      reviewedAt: input.reviewedAt,
      reviewNotes: input.reviewNotes,
      rejectedReason: input.rejectedReason,
      changeRequest: input.changeRequest,
      bank: input.bank,
      documents: {
        uploaded: current.length,
        pending: current.filter((d) => PENDING_DOCUMENT_STATUSES.has(d.status))
          .length,
        verified: current.filter((d) => d.status === DocumentStatus.VERIFIED)
          .length,
        rejected: current.filter((d) => d.status === DocumentStatus.REJECTED)
          .length,
        missing: input.slots
          .filter(
            (def) =>
              def.required &&
              !current.some((doc) => this.slotOf(doc) === def.slot),
          )
          .map((def) => def.name),
      },
      verification: {
        pan: verificationState(pan),
        gst: verificationState(gst),
        panMasked: pan?.identifierMasked ?? null,
        gstinMasked: gst?.identifierMasked ?? null,
        mismatch: hasPanGstMismatch(pan, gst, input.organization.gstin),
      },
      source:
        (latestDoc
          ? str(readJsonObject(latestDoc.metadata).uploadSource)
          : null) ??
        latestAttempt?.source ??
        null,
      createdAt: input.createdAt.toISOString(),
      lastActivityAt: lastActivity ?? input.createdAt.toISOString(),
    };
  }

  private sellerKycStatus(
    seller: SellerRow,
    changesRequested: boolean,
  ): AdminKycStatus {
    const onboarding = seller.onboarding?.status;
    if (seller.status === SellerStatus.APPROVED) return 'APPROVED';
    if (
      seller.status === SellerStatus.REJECTED ||
      onboarding === SellerOnboardingStatus.REJECTED
    ) {
      return 'REJECTED';
    }
    if (
      onboarding === SellerOnboardingStatus.SUBMITTED ||
      onboarding === SellerOnboardingStatus.UNDER_REVIEW
    ) {
      return 'UNDER_REVIEW';
    }
    if (changesRequested) return 'CHANGES_REQUESTED';
    if (onboarding === SellerOnboardingStatus.APPROVED) return 'APPROVED';
    return 'PENDING';
  }

  private customerKycStatus(
    kyc: CustomerKycState,
    orgVerification: VerificationStatus,
  ): AdminKycStatus {
    switch (kyc.status) {
      case 'SUBMITTED':
        return 'UNDER_REVIEW';
      case 'CHANGES_REQUESTED':
        return 'CHANGES_REQUESTED';
      case 'APPROVED':
        return 'APPROVED';
      case 'REJECTED':
        return 'REJECTED';
      default:
        return orgVerification === VerificationStatus.APPROVED
          ? 'APPROVED'
          : 'PENDING';
    }
  }

  /** Confirmed onboarding/KYC files keyed by owner profile id, newest first. */
  private async kycDocuments(
    entityType: AdminKycEntityType,
    ownerIds: string[],
  ): Promise<Map<string, KycDocumentRow[]>> {
    const result = new Map<string, KycDocumentRow[]>();
    if (!ownerIds.length) return result;
    const purpose =
      entityType === 'SELLER'
        ? SELLER_ONBOARDING_DOCUMENT_PURPOSE
        : CUSTOMER_KYC_DOCUMENT_PURPOSE;
    const rows = await this.prisma.document.findMany({
      where: {
        deletedAt: null,
        ownerType:
          entityType === 'SELLER'
            ? EntityOwnerType.SELLER
            : EntityOwnerType.CUSTOMER,
        ownerId: { in: ownerIds },
        status: { in: ACTIVE_DOCUMENT_STATUSES },
        metadata: { path: ['purpose'], equals: purpose },
      },
      select: kycDocumentSelect,
      orderBy: { createdAt: 'desc' },
    });
    for (const row of rows) {
      const meta = readJsonObject(row.metadata);
      if (meta.r2Confirmed !== true || typeof meta.slot !== 'string') continue;
      const list = result.get(row.ownerId) ?? [];
      list.push(row);
      result.set(row.ownerId, list);
    }
    return result;
  }

  /** The document an admin should look at for each slot. */
  private currentDocuments(
    slots: readonly SlotDefinition[],
    docs: KycDocumentRow[],
  ): KycDocumentRow[] {
    const current: KycDocumentRow[] = [];
    for (const def of slots) {
      const slotDocs = docs.filter((doc) => this.slotOf(doc) === def.slot);
      const pick =
        slotDocs.find((doc) => doc.status !== DocumentStatus.REJECTED) ??
        slotDocs[0];
      if (pick) current.push(pick);
    }
    return current;
  }

  private approvalBlockers(
    slots: readonly SlotDefinition[],
    docs: KycDocumentRow[],
  ): string[] {
    const blockers: string[] = [];
    for (const def of slots) {
      if (!def.required) continue;
      const slotDocs = docs.filter((doc) => this.slotOf(doc) === def.slot);
      if (slotDocs.some((doc) => doc.status !== DocumentStatus.REJECTED)) {
        continue;
      }
      blockers.push(
        slotDocs.length ? `${def.name} (rejected)` : `${def.name} (missing)`,
      );
    }
    return blockers;
  }

  private slotViews(slots: readonly SlotDefinition[], docs: KycDocumentRow[]) {
    const current = this.currentDocuments(slots, docs);
    return slots.map((def) => {
      const doc = current.find((item) => this.slotOf(item) === def.slot);
      return {
        slot: def.slot,
        name: def.name,
        description: def.description,
        required: def.required,
        document: doc ? this.documentView(doc, def.name) : null,
      };
    });
  }

  private documentView(doc: KycDocumentRow, slotLabel: string) {
    const meta = readJsonObject(doc.metadata);
    return {
      id: doc.id,
      slot: this.slotOf(doc),
      slotLabel,
      category: doc.category,
      fileName: doc.originalFileName ?? doc.fileName,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes?.toString() ?? null,
      status: doc.status,
      rejectionReason: doc.rejectionReason,
      verificationNotes: doc.verificationNotes,
      uploadSource: str(meta.uploadSource),
      uploadedAt: doc.createdAt.toISOString(),
      reviewedAt: iso(doc.approvedAt ?? doc.rejectedAt),
    };
  }

  private slotOf(doc: KycDocumentRow): string | null {
    return str(readJsonObject(doc.metadata).slot);
  }

  private slotLabel(doc: KycDocumentRow): string | null {
    const slot = this.slotOf(doc);
    return (
      CUSTOMER_KYC_DOCUMENT_SLOTS.find((def) => def.slot === slot)?.name ?? null
    );
  }

  private async bankSummaries(
    organizationIds: string[],
  ): Promise<Map<string, BankSummary>> {
    const result = new Map<string, BankSummary>();
    if (!organizationIds.length) return result;
    const accounts = await this.prisma.bankAccount.findMany({
      where: { organizationId: { in: organizationIds }, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
      select: {
        organizationId: true,
        accountHolder: true,
        bankName: true,
        accountNumber: true,
        ifsc: true,
      },
    });
    for (const account of accounts) {
      if (result.has(account.organizationId)) continue;
      result.set(account.organizationId, {
        accountHolder: account.accountHolder,
        bankName: account.bankName,
        accountLast4: last4(account.accountNumber),
        ifsc: account.ifsc,
      });
    }
    return result;
  }
}
