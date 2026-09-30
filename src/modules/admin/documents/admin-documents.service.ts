import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentStatus,
  EntityOwnerType,
  Prisma,
  type Document,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { StorageService } from '../../../storage/storage.service.js';
import { NotificationService } from '../../notifications/notification.service.js';
import { DocumentsCoreService } from '../../documents/services/documents-core.service.js';
import {
  CUSTOMER_KYC_DOCUMENT_PURPOSE,
  resolveCustomerKycSlot,
} from '../../customers/kyc/customer-kyc.slots.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import {
  SELLER_ONBOARDING_DOCUMENT_PURPOSE,
  readJsonObject,
  resolveOnboardingSlot,
} from '../../sellers/onboarding/onboarding-documents.slots.js';
import { AdminAuditService } from '../common/admin-audit.service.js';
import type {
  AdminDocumentActionDto,
  AdminDocumentDownloadQueryDto,
  AdminDocumentsQueryDto,
} from './admin-documents.dto.js';

/** Admin preview/download links are short-lived; the UI re-requests on each click. */
const ADMIN_SIGNED_URL_SECONDS = 300;

const documentInclude = {
  organization: {
    select: { id: true, name: true, legalName: true, gstin: true, pan: true },
  },
  uploadedBy: {
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.DocumentInclude;

type DocumentWithRelations = Prisma.DocumentGetPayload<{
  include: typeof documentInclude;
}>;

type SellerSummary = {
  id: string;
  status: string;
  onboardingStatus: string | null;
  onboardingSubmittedAt: Date | null;
};

@Injectable()
export class AdminDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly notifications: NotificationService,
    private readonly documents: DocumentsCoreService,
    private readonly storage: StorageService,
  ) {}

  async list(query: AdminDocumentsQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const and: Prisma.DocumentWhereInput[] = [{ deletedAt: null }];
    if (query.status) and.push({ status: query.status });
    if (query.category) and.push({ category: query.category });
    if (query.organizationId) {
      and.push({ organizationId: query.organizationId });
    }
    if (query.ownerType) and.push({ ownerType: query.ownerType });
    if (query.sellerProfileId) {
      and.push({
        ownerType: EntityOwnerType.SELLER,
        ownerId: query.sellerProfileId,
      });
    }
    if (query.purpose) {
      and.push({ metadata: { path: ['purpose'], equals: query.purpose } });
    }
    if (query.from || query.to) {
      and.push({
        createdAt: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {}),
        },
      });
    }
    if (query.search?.trim()) {
      const q = query.search.trim();
      and.push({
        OR: [
          { fileName: { contains: q, mode: 'insensitive' } },
          { originalFileName: { contains: q, mode: 'insensitive' } },
          { documentNumber: { contains: q, mode: 'insensitive' } },
          { organization: { name: { contains: q, mode: 'insensitive' } } },
          {
            organization: { legalName: { contains: q, mode: 'insensitive' } },
          },
        ],
      });
    }

    const hiddenIds = await this.unconfirmedOnboardingIds();
    if (hiddenIds.length) and.push({ id: { notIn: hiddenIds } });

    const where: Prisma.DocumentWhereInput = { AND: and };
    const [items, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: documentInclude,
      }),
      this.prisma.document.count({ where }),
    ]);

    const sellers = await this.sellerSummaries(items);
    return {
      items: items.map((d) => this.toAdminView(d, sellers)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...documentInclude,
        versions: { orderBy: { versionNumber: 'desc' } },
      },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const sellers = await this.sellerSummaries([doc]);
    return {
      ...this.toAdminView(doc, sellers),
      versions: doc.versions.map((v) => ({
        ...v,
        fileSizeBytes:
          v.fileSizeBytes != null ? v.fileSizeBytes.toString() : null,
      })),
    };
  }

  async versions(id: string) {
    return this.documents.versions(id);
  }

  async expiring(days?: number) {
    return this.documents.listExpiring(days ?? 30);
  }

  async approve(id: string, actorUserId: string, dto: AdminDocumentActionDto) {
    const existing = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Document not found');
    await this.assertFileStored(existing);

    const doc = await this.documents.approve(id, actorUserId, {
      notes: dto.notes,
      reason: dto.reason,
    });

    // Clear review flags so seller panel shows a clean verified state.
    const meta = readJsonObject(existing.metadata);
    if (meta.awaitingAdminReview || meta.r2Confirmed === false) {
      await this.prisma.document.update({
        where: { id },
        data: {
          metadata: {
            ...meta,
            awaitingAdminReview: false,
            r2Confirmed: true,
            approvedVia: 'admin',
          } as Prisma.InputJsonValue,
        },
      });
    }

    await this.audit.log({
      action: 'DOCUMENT_APPROVED',
      actorUserId,
      organizationId: existing.organizationId ?? undefined,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: id,
      previousData: { status: existing.status },
      newData: { status: DocumentStatus.VERIFIED },
    });

    if (existing.uploadedById) {
      await this.notifications.create({
        userId: existing.uploadedById,
        organizationId: existing.organizationId ?? undefined,
        title: 'Document approved',
        body: `Your document ${this.displayName(existing)} was verified.`,
        entityType: EntityOwnerType.DOCUMENT,
        entityId: id,
        metadata: { status: DocumentStatus.VERIFIED },
      });
    }

    return doc;
  }

  async reject(id: string, actorUserId: string, dto: AdminDocumentActionDto) {
    const reason = (dto.reason ?? dto.notes)?.trim();
    if (!reason) {
      throw new BadRequestException('Rejection reason is required');
    }

    const existing = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Document not found');

    const doc = await this.documents.reject(id, actorUserId, {
      reason,
      notes: dto.notes,
    });

    await this.audit.log({
      action: 'DOCUMENT_REJECTED',
      actorUserId,
      organizationId: existing.organizationId ?? undefined,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: id,
      previousData: { status: existing.status },
      newData: { status: DocumentStatus.REJECTED, reason },
    });

    if (existing.uploadedById) {
      await this.notifications.create({
        userId: existing.uploadedById,
        organizationId: existing.organizationId ?? undefined,
        title: 'Document rejected',
        body: `Your document ${this.displayName(existing)} was rejected: ${reason}. Please upload a replacement.`,
        entityType: EntityOwnerType.DOCUMENT,
        entityId: id,
        metadata: { status: DocumentStatus.REJECTED, reason },
      });
    }

    return doc;
  }

  async download(
    id: string,
    actorUserId: string,
    query: AdminDocumentDownloadQueryDto,
  ) {
    const disposition = query.disposition ?? 'attachment';
    const result = await this.documents.download(id, undefined, {
      disposition,
      expiresInSeconds: ADMIN_SIGNED_URL_SECONDS,
      verifyExists: true,
    });

    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    await this.audit.log({
      action:
        disposition === 'inline' ? 'DOCUMENT_PREVIEWED' : 'DOCUMENT_DOWNLOADED',
      actorUserId,
      organizationId: doc?.organizationId ?? undefined,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: id,
    });

    return result;
  }

  /**
   * Onboarding rows are created before the file reaches R2. Until the seller
   * confirms the upload there is nothing to review, so admins never see them.
   */
  private async unconfirmedOnboardingIds(): Promise<string[]> {
    const rows = await this.prisma.document.findMany({
      where: {
        deletedAt: null,
        status: DocumentStatus.UPLOADED,
        OR: [
          SELLER_ONBOARDING_DOCUMENT_PURPOSE,
          CUSTOMER_KYC_DOCUMENT_PURPOSE,
        ].map((purpose) => ({
          metadata: { path: ['purpose'], equals: purpose },
        })),
      },
      select: { id: true, metadata: true },
    });
    return rows
      .filter((row) => readJsonObject(row.metadata).r2Confirmed !== true)
      .map((row) => row.id);
  }

  private async sellerSummaries(
    docs: Pick<Document, 'ownerType' | 'ownerId'>[],
  ): Promise<Map<string, SellerSummary>> {
    const ids = [
      ...new Set(
        docs
          .filter((d) => d.ownerType === EntityOwnerType.SELLER)
          .map((d) => d.ownerId),
      ),
    ];
    if (!ids.length) return new Map();
    const sellers = await this.prisma.sellerProfile.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        status: true,
        onboarding: { select: { status: true, submittedAt: true } },
      },
    });
    return new Map(
      sellers.map((s) => [
        s.id,
        {
          id: s.id,
          status: s.status,
          onboardingStatus: s.onboarding?.status ?? null,
          onboardingSubmittedAt: s.onboarding?.submittedAt ?? null,
        },
      ]),
    );
  }

  private toAdminView(
    doc: DocumentWithRelations,
    sellers: Map<string, SellerSummary>,
  ) {
    const meta = readJsonObject(doc.metadata);
    const slot = typeof meta.slot === 'string' ? meta.slot : null;
    const purpose = typeof meta.purpose === 'string' ? meta.purpose : null;
    const slotDef = !slot
      ? undefined
      : purpose === CUSTOMER_KYC_DOCUMENT_PURPOSE
        ? resolveCustomerKycSlot(slot)
        : resolveOnboardingSlot(slot);
    return {
      ...this.documents.mapDocument(doc),
      organization: doc.organization,
      uploadedBy: doc.uploadedBy,
      purpose,
      slot,
      slotLabel: slotDef?.name ?? null,
      uploadSource:
        typeof meta.uploadSource === 'string' ? meta.uploadSource : null,
      seller:
        doc.ownerType === EntityOwnerType.SELLER
          ? (sellers.get(doc.ownerId) ?? null)
          : null,
    };
  }

  private async assertFileStored(doc: Document) {
    if (!this.storage.isConfigured()) return;
    const stored = await this.storage.exists(doc.storageKey);
    if (!stored) {
      throw new BadRequestException(
        'The file for this document is missing from storage. Ask the seller to upload it again.',
      );
    }
  }

  private displayName(doc: Document) {
    return doc.originalFileName ?? doc.fileName ?? doc.documentNumber;
  }
}
