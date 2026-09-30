import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EntityOwnerType,
  OrganizationStatus,
  Prisma,
  SellerOnboardingStatus,
  SellerStatus,
  UserStatus,
  VerificationStatus,
  DocumentStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { NotificationService } from '../../notifications/notification.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { DocumentStateService } from '../../documents/common/document-state.service.js';
import {
  resolvedChangeRequest,
  type KycChangeRequest,
} from '../../documents/common/kyc-change-request.js';
import {
  SELLER_ONBOARDING_DOCUMENT_SLOTS,
  readJsonObject,
  resolveOnboardingSlot,
} from '../../sellers/onboarding/onboarding-documents.slots.js';
import { AdminAuditService } from '../common/admin-audit.service.js';
import type { AdminKycRequestChangesDto } from '../kyc/admin-kyc.dto.js';
import type {
  AdminSellerActionDto,
  AdminSellersQueryDto,
} from './admin-sellers.dto.js';

function slotName(slot: string | null): string | null {
  return slot ? (resolveOnboardingSlot(slot)?.name ?? null) : null;
}

function closedChangeRequestMetadata(
  metadata: unknown,
): Prisma.InputJsonValue | undefined {
  const current = readJsonObject(metadata);
  if (!current.changeRequest) return undefined;
  return {
    ...current,
    changeRequest: resolvedChangeRequest(current.changeRequest),
  } as Prisma.InputJsonValue;
}

const sellerInclude = {
  user: {
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      displayName: true,
      status: true,
    },
  },
  organization: {
    select: {
      id: true,
      name: true,
      legalName: true,
      code: true,
      status: true,
      verificationStatus: true,
      gstin: true,
      pan: true,
    },
  },
  onboarding: {
    select: {
      id: true,
      status: true,
      currentStep: true,
      submittedAt: true,
      reviewedAt: true,
    },
  },
  verification: true,
  _count: {
    select: {
      products: true,
      offers: true,
      inventory: true,
      orders: true,
    },
  },
} satisfies Prisma.SellerProfileInclude;

@Injectable()
export class AdminSellersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly notifications: NotificationService,
    private readonly documentState: DocumentStateService,
  ) {}

  async list(query: AdminSellersQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.SellerProfileWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { organization: { name: { contains: q, mode: 'insensitive' } } },
        { organization: { legalName: { contains: q, mode: 'insensitive' } } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
        { user: { phone: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.sellerProfile.findMany({
        where,
        include: sellerInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.sellerProfile.count({ where }),
    ]);

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findOne(id: string) {
    const seller = await this.prisma.sellerProfile.findFirst({
      where: { id, deletedAt: null },
      include: sellerInclude,
    });
    if (!seller) throw new NotFoundException('Seller not found');

    const onboardingDocuments = await this.prisma.document.findMany({
      where: {
        deletedAt: null,
        ownerType: EntityOwnerType.SELLER,
        ownerId: id,
        status: { notIn: [DocumentStatus.ARCHIVED, DocumentStatus.REPLACED] },
      },
      orderBy: [{ category: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        category: true,
        fileName: true,
        originalFileName: true,
        mimeType: true,
        fileSizeBytes: true,
        status: true,
        storageProvider: true,
        storageKey: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        rejectionReason: true,
      },
    });

    return {
      ...seller,
      onboardingDocuments: onboardingDocuments
        .filter((doc) => {
          const meta =
            doc.metadata && typeof doc.metadata === 'object'
              ? (doc.metadata as Record<string, unknown>)
              : {};
          return (
            meta.purpose === 'SELLER_ONBOARDING' && meta.r2Confirmed === true
          );
        })
        .map((doc) => ({
          ...doc,
          fileSizeBytes:
            doc.fileSizeBytes != null ? doc.fileSizeBytes.toString() : null,
          slot:
            doc.metadata &&
            typeof doc.metadata === 'object' &&
            typeof (doc.metadata as Record<string, unknown>).slot === 'string'
              ? ((doc.metadata as Record<string, unknown>).slot as string)
              : null,
        })),
    };
  }

  async approve(id: string, actorUserId: string, dto: AdminSellerActionDto) {
    const seller = await this.findOne(id);
    if (seller.status === SellerStatus.APPROVED) {
      throw new BadRequestException('Seller is already approved');
    }

    const pendingDocumentIds: string[] = [];
    if (seller.onboarding) {
      const blockers: string[] = [];
      for (const def of SELLER_ONBOARDING_DOCUMENT_SLOTS) {
        if (!def.required) continue;
        const slotDocs = seller.onboardingDocuments.filter(
          (doc) => doc.slot === def.slot,
        );
        const current = slotDocs.find(
          (doc) => doc.status !== DocumentStatus.REJECTED,
        );
        if (current) {
          if (current.status !== DocumentStatus.VERIFIED) {
            pendingDocumentIds.push(current.id);
          }
          continue;
        }
        blockers.push(
          slotDocs.length ? `${def.name} (rejected)` : `${def.name} (missing)`,
        );
      }
      if (blockers.length) {
        throw new BadRequestException(
          `Seller cannot be approved until onboarding documents are complete: ${blockers.join(', ')}`,
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Approving the seller signs off on every onboarding file still awaiting review.
      if (pendingDocumentIds.length) {
        await tx.document.updateMany({
          where: { id: { in: pendingDocumentIds } },
          data: {
            status: DocumentStatus.VERIFIED,
            approvedById: actorUserId,
            approvedAt: new Date(),
            rejectedById: null,
            rejectedAt: null,
            rejectionReason: null,
            verificationNotes: 'Verified with seller approval',
          },
        });
      }

      const profile = await tx.sellerProfile.update({
        where: { id },
        data: {
          status: SellerStatus.APPROVED,
          approvedAt: new Date(),
          verificationNotes:
            dto.notes ?? dto.reason ?? seller.verificationNotes,
        },
        include: sellerInclude,
      });

      if (profile.onboarding) {
        await tx.sellerOnboarding.update({
          where: { sellerProfileId: id },
          data: {
            status: SellerOnboardingStatus.APPROVED,
            reviewedAt: new Date(),
            reviewNotes: dto.notes ?? dto.reason,
          },
        });
      }

      await tx.sellerVerification.upsert({
        where: { sellerProfileId: id },
        create: {
          sellerProfileId: id,
          overallStatus: VerificationStatus.APPROVED,
          reviewedAt: new Date(),
          notes: dto.notes ?? dto.reason,
        },
        update: {
          overallStatus: VerificationStatus.APPROVED,
          reviewedAt: new Date(),
          notes: dto.notes ?? dto.reason,
          metadata: closedChangeRequestMetadata(seller.verification?.metadata),
        },
      });

      await tx.organization.update({
        where: { id: seller.organizationId },
        data: {
          status: OrganizationStatus.ACTIVE,
          verificationStatus: VerificationStatus.APPROVED,
          verifiedAt: new Date(),
        },
      });

      await tx.user.update({
        where: { id: seller.userId },
        data: { status: UserStatus.ACTIVE },
      });

      return profile;
    });

    await this.audit.log({
      action: 'SELLER_APPROVED',
      actorUserId,
      organizationId: seller.organizationId,
      entityType: EntityOwnerType.SELLER,
      entityId: id,
      previousData: { status: seller.status },
      newData: {
        status: SellerStatus.APPROVED,
        verifiedDocumentIds: pendingDocumentIds,
      },
    });

    await this.notifications.create({
      userId: seller.userId,
      organizationId: seller.organizationId,
      title: 'Seller account approved',
      body: 'Your seller account has been approved. You can now list products and offers.',
      entityType: EntityOwnerType.SELLER,
      entityId: id,
    });

    return this.findOne(id).catch(() => updated);
  }

  async reject(id: string, actorUserId: string, dto: AdminSellerActionDto) {
    const seller = await this.findOne(id);
    const reason = dto.reason ?? dto.notes;
    if (!reason?.trim()) {
      throw new BadRequestException('Rejection reason is required');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.sellerProfile.update({
        where: { id },
        data: {
          status: SellerStatus.REJECTED,
          verificationNotes: reason,
        },
      });

      if (seller.onboarding) {
        await tx.sellerOnboarding.update({
          where: { sellerProfileId: id },
          data: {
            status: SellerOnboardingStatus.REJECTED,
            reviewedAt: new Date(),
            reviewNotes: reason,
            rejectedReason: reason,
          },
        });
      }

      await tx.sellerVerification.upsert({
        where: { sellerProfileId: id },
        create: {
          sellerProfileId: id,
          overallStatus: VerificationStatus.REJECTED,
          reviewedAt: new Date(),
          notes: reason,
        },
        update: {
          overallStatus: VerificationStatus.REJECTED,
          reviewedAt: new Date(),
          notes: reason,
          metadata: closedChangeRequestMetadata(seller.verification?.metadata),
        },
      });

      await tx.organization.update({
        where: { id: seller.organizationId },
        data: {
          status: OrganizationStatus.REJECTED,
          verificationStatus: VerificationStatus.REJECTED,
        },
      });
    });

    await this.audit.log({
      action: 'SELLER_REJECTED',
      actorUserId,
      organizationId: seller.organizationId,
      entityType: EntityOwnerType.SELLER,
      entityId: id,
      previousData: { status: seller.status },
      newData: { status: SellerStatus.REJECTED, reason },
    });

    await this.notifications.create({
      userId: seller.userId,
      organizationId: seller.organizationId,
      title: 'Seller account rejected',
      body: reason,
      entityType: EntityOwnerType.SELLER,
      entityId: id,
    });

    return this.findOne(id);
  }

  /**
   * Send onboarding back to the seller: selected files are rejected with the
   * reason, onboarding reopens for edits, and the seller is notified.
   */
  async requestChanges(
    id: string,
    actorUserId: string,
    dto: AdminKycRequestChangesDto,
  ) {
    const seller = await this.findOne(id);
    if (!seller.onboarding) {
      throw new BadRequestException('Seller has not started onboarding yet');
    }
    if (seller.status === SellerStatus.APPROVED) {
      throw new BadRequestException(
        'Seller is already approved. Suspend the seller to force re-verification.',
      );
    }
    const reason = dto.reason.trim();
    const documentIds = [...new Set(dto.documentIds ?? [])];
    const selected = seller.onboardingDocuments.filter((doc) =>
      documentIds.includes(doc.id),
    );
    if (selected.length !== documentIds.length) {
      throw new BadRequestException(
        "Some selected documents are not part of this seller's onboarding",
      );
    }
    for (const doc of selected) {
      if (doc.status === DocumentStatus.VERIFIED) {
        throw new BadRequestException(
          `${slotName(doc.slot) ?? doc.fileName} is already verified and cannot be sent back`,
        );
      }
      this.documentState.assertTransition(doc.status, DocumentStatus.REJECTED);
    }

    const now = new Date();
    const changeRequest: KycChangeRequest = {
      reason,
      documentIds,
      slots: selected
        .map((doc) => doc.slot)
        .filter((slot): slot is string => Boolean(slot)),
      requestedAt: now.toISOString(),
      requestedById: actorUserId,
      resolvedAt: null,
    };

    await this.prisma.$transaction(async (tx) => {
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

      await tx.sellerOnboarding.update({
        where: { sellerProfileId: id },
        data: {
          status: SellerOnboardingStatus.IN_PROGRESS,
          currentStep: 'documents',
          reviewedAt: now,
          reviewNotes: reason,
        },
      });

      await tx.sellerProfile.update({
        where: { id },
        data: {
          status: SellerStatus.PENDING_VERIFICATION,
          verificationNotes: reason,
        },
      });

      const verification = await tx.sellerVerification.findUnique({
        where: { sellerProfileId: id },
        select: { metadata: true },
      });
      const metadata = {
        ...readJsonObject(verification?.metadata),
        changeRequest,
      } as Prisma.InputJsonValue;
      await tx.sellerVerification.upsert({
        where: { sellerProfileId: id },
        create: {
          sellerProfileId: id,
          overallStatus: VerificationStatus.PENDING,
          reviewedAt: now,
          notes: reason,
          metadata,
        },
        update: {
          overallStatus: VerificationStatus.PENDING,
          reviewedAt: now,
          notes: reason,
          metadata,
        },
      });

      await tx.organization.update({
        where: { id: seller.organizationId },
        data: { verificationStatus: VerificationStatus.PENDING },
      });
    });

    await this.audit.log({
      action: 'SELLER_CHANGES_REQUESTED',
      actorUserId,
      organizationId: seller.organizationId,
      entityType: EntityOwnerType.SELLER,
      entityId: id,
      previousData: {
        status: seller.status,
        onboardingStatus: seller.onboarding.status,
      },
      newData: {
        status: SellerStatus.PENDING_VERIFICATION,
        onboardingStatus: SellerOnboardingStatus.IN_PROGRESS,
        reason,
        documentIds,
      },
    });

    const docNames = changeRequest.slots
      .map((slot) => slotName(slot))
      .filter(Boolean);
    await this.notifications.create({
      userId: seller.userId,
      organizationId: seller.organizationId,
      title: 'Action required: update your seller verification',
      body: docNames.length
        ? `Please re-upload ${docNames.join(', ')}. ${reason}`
        : reason,
      entityType: EntityOwnerType.SELLER,
      entityId: id,
      metadata: {
        type: 'KYC_CHANGES_REQUESTED',
        slots: changeRequest.slots,
        documentIds,
      },
    });

    return this.findOne(id);
  }

  async suspend(id: string, actorUserId: string, dto: AdminSellerActionDto) {
    const seller = await this.findOne(id);
    const reason = dto.reason ?? dto.notes ?? 'Suspended by admin';

    await this.prisma.$transaction(async (tx) => {
      await tx.sellerProfile.update({
        where: { id },
        data: {
          status: SellerStatus.SUSPENDED,
          verificationNotes: reason,
        },
      });
      await tx.organization.update({
        where: { id: seller.organizationId },
        data: { status: OrganizationStatus.SUSPENDED },
      });
      await tx.user.update({
        where: { id: seller.userId },
        data: { status: UserStatus.SUSPENDED },
      });
    });

    await this.audit.log({
      action: 'SELLER_SUSPENDED',
      actorUserId,
      organizationId: seller.organizationId,
      entityType: EntityOwnerType.SELLER,
      entityId: id,
      previousData: { status: seller.status },
      newData: { status: SellerStatus.SUSPENDED, reason },
    });

    await this.notifications.create({
      userId: seller.userId,
      organizationId: seller.organizationId,
      title: 'Seller account suspended',
      body: reason,
      entityType: EntityOwnerType.SELLER,
      entityId: id,
    });

    return this.findOne(id);
  }
}
