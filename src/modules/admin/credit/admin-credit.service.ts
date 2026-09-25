import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreditAccountStatus,
  CreditApplicationStatus,
  CreditInsuranceClaimStatus,
  CreditInsuranceStatus,
  CreditStatus,
  CreditTransactionType,
  DocumentCategory,
  EntityOwnerType,
  Prisma,
  StorageProvider,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { StorageService } from '../../../storage/storage.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { generateUniqueCreditRef } from '../../payments/common/credit-number.js';
import { cmp, toDecimal } from '../../payments/common/money.util.js';
import { PLATFORM_CREDIT_METHODS } from '../../payments/common/platform-credit.js';
import {
  ACTIONABLE_CREDIT_APPLICATION_STATUSES,
  CREDIT_APPLICATION_EVENT,
  TERMINAL_CREDIT_APPLICATION_STATUSES,
} from '../../payments/common/credit-workflow.js';
import {
  CreditLedgerService,
  utilizationPercentage,
} from '../../payments/services/credit-ledger.service.js';
import { CreditTimelineService } from '../../payments/services/credit-timeline.service.js';
import { DocumentsCoreService } from '../../documents/services/documents-core.service.js';
import { NotificationService } from '../../notifications/notification.service.js';
import { AdminAuditService } from '../common/admin-audit.service.js';
import type {
  AdminCreditAccountActionDto,
  AdminCreditAccountsQueryDto,
  AdminCreditAdjustLimitDto,
  AdminCreditApplicationsQueryDto,
  AdminCreditApproveDto,
  AdminCreditArrangementDto,
  AdminCreditAuditQueryDto,
  AdminCreditDocumentRejectDto,
  AdminCreditDocumentVerifyDto,
  AdminCreditDocumentsQueryDto,
  AdminCreditInsuranceReviewDto,
  AdminCreditInsuranceUpdateDto,
  AdminCreditPartialApproveDto,
  AdminCreditRejectDto,
  AdminCreditRepaymentsQueryDto,
  AdminCreditRequestDocumentDto,
  AdminCreditRequestDocumentsDto,
  AdminCreditTransactionsQueryDto,
} from './admin-credit.dto.js';
import {
  CREDIT_CUSTOMER_SELECT,
  mapAccount,
  mapApplication,
  mapAuditEvent,
  mapDocument,
  mapInsurance,
  mapRepayment,
  mapTransaction,
} from './admin-credit.mapper.js';

const CREDIT_DOC_CATEGORIES: DocumentCategory[] = [
  DocumentCategory.CREDIT_APPLICATION,
  DocumentCategory.FINANCIAL_STATEMENT,
  DocumentCategory.KYC,
  DocumentCategory.GST,
  DocumentCategory.PAN,
  DocumentCategory.BANK,
  DocumentCategory.COMPLIANCE,
];

const CREDIT_METHODS = PLATFORM_CREDIT_METHODS;

const OPEN_APPLICATION = ACTIONABLE_CREDIT_APPLICATION_STATUSES;

const START_REVIEW_FROM: CreditApplicationStatus[] = [
  CreditApplicationStatus.PENDING,
  CreditApplicationStatus.DOCUMENTS_UNDER_REVIEW,
  CreditApplicationStatus.DOCUMENTS_REQUIRED,
];

const ADMIN_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  displayName: true,
  email: true,
} as const;

@Injectable()
export class AdminCreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly ledger: CreditLedgerService,
    private readonly documents: DocumentsCoreService,
    private readonly notifications: NotificationService,
    private readonly storage: StorageService,
    private readonly timeline: CreditTimelineService,
  ) {}

  async summary() {
    const actionable = ACTIONABLE_CREDIT_APPLICATION_STATUSES;

    const [
      totalCustomers,
      pendingApplications,
      approvedAccounts,
      activeCredit,
      applicationsRequiringAction,
      suspendedAccounts,
      aggregates,
      recentApplications,
      recentTransactions,
    ] = await Promise.all([
      this.prisma.customerCreditProfile.count(),
      this.prisma.creditApplication.count({
        where: { status: CreditApplicationStatus.PENDING },
      }),
      this.prisma.customerCreditProfile.count({
        where: { status: CreditStatus.APPROVED },
      }),
      this.prisma.customerCreditProfile.count({
        where: {
          status: CreditStatus.APPROVED,
          accountStatus: CreditAccountStatus.ACTIVE,
        },
      }),
      this.prisma.creditApplication.count({
        where: { status: { in: actionable } },
      }),
      this.prisma.customerCreditProfile.count({
        where: { accountStatus: CreditAccountStatus.SUSPENDED },
      }),
      this.prisma.customerCreditProfile.aggregate({
        _sum: {
          approvedLimit: true,
          availableLimit: true,
          utilizedAmount: true,
          pendingCredit: true,
          outstandingAmount: true,
          overdueAmount: true,
        },
      }),
      this.prisma.creditApplication.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          customerProfile: { select: CREDIT_CUSTOMER_SELECT },
        },
      }),
      this.prisma.creditTransaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          customerProfile: { select: CREDIT_CUSTOMER_SELECT },
        },
      }),
    ]);

    return {
      totalCustomers,
      totalAccounts: totalCustomers,
      pendingApplications,
      approvedAccounts,
      activeCredit,
      activeCreditAccounts: activeCredit,
      suspendedAccounts,
      applicationsRequiringAction,
      approvedLimit: toDecimal(aggregates._sum.approvedLimit).toFixed(2),
      totalApprovedCredit: toDecimal(aggregates._sum.approvedLimit).toFixed(2),
      availableCredit: toDecimal(aggregates._sum.availableLimit).toFixed(2),
      pendingCredit: toDecimal(aggregates._sum.pendingCredit).toFixed(2),
      utilizedCredit: toDecimal(aggregates._sum.utilizedAmount).toFixed(2),
      outstandingAmount: toDecimal(aggregates._sum.outstandingAmount).toFixed(
        2,
      ),
      overdueAmount: toDecimal(aggregates._sum.overdueAmount).toFixed(2),
      utilizationPercentage: utilizationPercentage(
        aggregates._sum.utilizedAmount,
        aggregates._sum.approvedLimit,
      ),
      recentApplications: recentApplications.map((row) => mapApplication(row)),
      recentTransactions: recentTransactions.map((row) => mapTransaction(row)),
    };
  }

  async listApplications(query: AdminCreditApplicationsQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.CreditApplicationWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.customerId) where.customerProfileId = query.customerId;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { applicationNumber: { contains: search, mode: 'insensitive' } },
        {
          customerProfile: {
            organization: { name: { contains: search, mode: 'insensitive' } },
          },
        },
        {
          customerProfile: {
            organization: {
              legalName: { contains: search, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.creditApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          customerProfile: { select: CREDIT_CUSTOMER_SELECT },
          assignedAdmin: { select: ADMIN_SELECT },
          creditProfile: {
            select: {
              id: true,
              accountNumber: true,
              approvedLimit: true,
              availableLimit: true,
              outstandingAmount: true,
            },
          },
        },
      }),
      this.prisma.creditApplication.count({ where }),
    ]);

    const orgIds = rows.map((row) => row.customerProfile.organization.id);
    const docCounts =
      orgIds.length === 0
        ? []
        : await this.prisma.document.groupBy({
            by: ['organizationId'],
            where: {
              deletedAt: null,
              organizationId: { in: orgIds },
              category: { in: CREDIT_DOC_CATEGORIES },
            },
            _count: { _all: true },
          });
    const countByOrg = new Map(
      docCounts.map((row) => [row.organizationId, row._count._all]),
    );

    return {
      items: rows.map((row) =>
        mapApplication(row, {
          documentCount:
            countByOrg.get(row.customerProfile.organization.id) ?? 0,
        }),
      ),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getApplication(id: string) {
    const row = await this.prisma.creditApplication.findUnique({
      where: { id },
      include: {
        customerProfile: { select: CREDIT_CUSTOMER_SELECT },
        assignedAdmin: { select: ADMIN_SELECT },
        creditProfile: {
          select: {
            id: true,
            accountNumber: true,
            approvedLimit: true,
            availableLimit: true,
            outstandingAmount: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Credit application not found');

    const [documents, audit, timeline] = await Promise.all([
      this.prisma.document.findMany({
        where: {
          deletedAt: null,
          OR: [
            {
              organizationId: row.customerProfile.organization.id,
              category: { in: CREDIT_DOC_CATEGORIES },
            },
            { ownerType: EntityOwnerType.CREDIT, ownerId: id },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          organization: { select: { id: true, name: true, legalName: true } },
        },
      }),
      this.prisma.auditLog.findMany({
        where: {
          OR: [
            { entityType: EntityOwnerType.CREDIT, entityId: id },
            {
              entityType: EntityOwnerType.CUSTOMER,
              entityId: row.customerProfileId,
              action: { startsWith: 'CREDIT_' },
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { actor: { select: ADMIN_SELECT } },
      }),
      this.timeline.list(id),
    ]);

    return {
      ...mapApplication(row, { documentCount: documents.length }),
      submittedAt: row.submittedAt,
      approvedTenureDays: row.approvedTenureDays,
      customerMessage: row.customerMessage,
      insuranceStatus: row.insuranceStatus,
      arrangementStatus: row.arrangementStatus,
      insurancePartner: row.insurancePartner,
      insuranceReference: row.insuranceReference,
      insuredAmount:
        row.insuredAmount != null
          ? toDecimal(row.insuredAmount).toFixed(2)
          : null,
      effectiveAt: row.effectiveAt,
      expiresAt: row.expiresAt,
      documents: documents.map((doc) => mapDocument(doc)),
      audit: audit.map((item) => mapAuditEvent(item)),
      timeline,
      storage: {
        configured: this.storage.isConfigured(),
        pending: !this.storage.isConfigured(),
      },
    };
  }

  async getTimeline(id: string) {
    await this.requireApplication(id);
    return this.timeline.list(id);
  }

  async startReview(id: string, actorUserId: string) {
    const application = await this.requireApplication(id);
    if (!START_REVIEW_FROM.includes(application.status)) {
      throw new BadRequestException(
        `Cannot start review from ${application.status}`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.creditApplication.update({
        where: { id },
        data: {
          status: CreditApplicationStatus.UNDER_REVIEW,
          assignedAdminId: actorUserId,
        },
      });
      await tx.customerProfile.update({
        where: { id: application.customerProfileId },
        data: { creditStatus: CreditStatus.UNDER_REVIEW },
      });
      await tx.customerCreditProfile.upsert({
        where: { customerProfileId: application.customerProfileId },
        update: {
          status: CreditStatus.UNDER_REVIEW,
          assignedAdminId: actorUserId,
        },
        create: {
          customerProfileId: application.customerProfileId,
          status: CreditStatus.UNDER_REVIEW,
          requestedLimit: application.requestedLimit,
          assignedAdminId: actorUserId,
          accountNumber: await this.nextAccountNumber(tx),
        },
      });
      return next;
    });

    await this.audit.log({
      action: CREDIT_APPLICATION_EVENT.REVIEW_STARTED,
      actorUserId,
      organizationId: application.customerProfile.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
      previousData: { status: application.status },
      newData: { status: CreditApplicationStatus.UNDER_REVIEW },
    });

    await this.timeline.record({
      creditApplicationId: id,
      eventType: CREDIT_APPLICATION_EVENT.REVIEW_STARTED,
      description: 'Credit review started',
      actorUserId,
      actorRole: 'ADMIN',
      customerVisible: true,
    });

    return this.getApplication(updated.id);
  }

  async requestDocuments(
    id: string,
    actorUserId: string,
    dto: AdminCreditRequestDocumentsDto,
  ) {
    const application = await this.requireApplication(id);
    if (!OPEN_APPLICATION.includes(application.status)) {
      throw new BadRequestException(
        `Cannot request documents from ${application.status}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.creditApplication.update({
        where: { id },
        data: {
          status: CreditApplicationStatus.DOCUMENTS_REQUIRED,
          assignedAdminId: actorUserId,
          notes: dto.message ?? application.notes,
          customerMessage: dto.message ?? application.customerMessage,
        },
      });
      await tx.customerProfile.update({
        where: { id: application.customerProfileId },
        data: { creditStatus: CreditStatus.DOCUMENTS_REQUIRED },
      });
    });

    await this.timeline.record({
      creditApplicationId: id,
      eventType: CREDIT_APPLICATION_EVENT.ADDITIONAL_DOCUMENTS_REQUESTED,
      description: dto.message?.trim() || 'Additional documents requested',
      actorUserId,
      actorRole: 'ADMIN',
      customerVisible: true,
      metadata: { documentTypes: dto.documentTypes ?? [] },
    });

    await this.audit.log({
      action: 'CREDIT_DOCUMENTS_REQUESTED',
      actorUserId,
      organizationId: application.customerProfile.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
      previousData: { status: application.status },
      newData: {
        status: CreditApplicationStatus.DOCUMENTS_REQUIRED,
        documentTypes: dto.documentTypes ?? [],
        message: dto.message ?? null,
      },
    });

    await this.notifications.create({
      userId: application.customerProfile.userId,
      organizationId: application.customerProfile.organizationId,
      title: 'Credit documents required',
      body:
        dto.message?.trim() ||
        'PetroTrade Credit Management requested additional documents for your credit application.',
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
      metadata: { documentTypes: dto.documentTypes ?? [] },
    });

    return this.getApplication(id);
  }

  async approve(id: string, actorUserId: string, dto: AdminCreditApproveDto) {
    return this.decideApproval(id, actorUserId, dto, false);
  }

  async partialApprove(
    id: string,
    actorUserId: string,
    dto: AdminCreditPartialApproveDto,
  ) {
    return this.decideApproval(id, actorUserId, dto, true);
  }

  private async decideApproval(
    id: string,
    actorUserId: string,
    dto: AdminCreditApproveDto,
    partial: boolean,
  ) {
    const application = await this.requireApplication(id);
    if (TERMINAL_CREDIT_APPLICATION_STATUSES.includes(application.status)) {
      throw new BadRequestException(
        `Cannot approve application in ${application.status}`,
      );
    }

    const approvedLimit = toDecimal(dto.approvedLimit);
    if (approvedLimit.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Approved limit must be greater than zero');
    }
    const nextStatus = partial
      ? CreditApplicationStatus.PARTIALLY_APPROVED
      : CreditApplicationStatus.APPROVED;
    const termDays =
      dto.creditTermDays ?? application.requestedTenureDays ?? 30;

    await this.prisma.$transaction(async (tx) => {
      const accountNumber = await this.ensureAccountNumber(
        tx,
        application.customerProfileId,
      );
      const profile = await tx.customerCreditProfile.upsert({
        where: { customerProfileId: application.customerProfileId },
        update: {
          status: CreditStatus.APPROVED,
          accountStatus: CreditAccountStatus.ACTIVE,
          approvedLimit,
          availableLimit: approvedLimit,
          utilizedAmount: 0,
          outstandingAmount: 0,
          overdueAmount: 0,
          requestedLimit: application.requestedLimit,
          creditTermDays: termDays,
          approvedAt: new Date(),
          effectiveAt: new Date(),
          reviewAt: dto.reviewAt ? new Date(dto.reviewAt) : undefined,
          assignedAdminId: actorUserId,
          notes: dto.reason ?? undefined,
        },
        create: {
          customerProfileId: application.customerProfileId,
          accountNumber,
          status: CreditStatus.APPROVED,
          accountStatus: CreditAccountStatus.ACTIVE,
          requestedLimit: application.requestedLimit,
          approvedLimit,
          availableLimit: approvedLimit,
          creditTermDays: termDays,
          approvedAt: new Date(),
          effectiveAt: new Date(),
          reviewAt: dto.reviewAt ? new Date(dto.reviewAt) : undefined,
          assignedAdminId: actorUserId,
          notes: dto.reason,
        },
      });

      await tx.creditApplication.update({
        where: { id },
        data: {
          status: nextStatus,
          creditProfileId: profile.id,
          assignedAdminId: actorUserId,
          decidedAt: new Date(),
          decisionReason: dto.reason,
          customerMessage: dto.customerMessage ?? application.customerMessage,
          approvedLimit,
          approvedTenureDays: termDays,
          effectiveAt: new Date(),
          expiresAt: dto.reviewAt ? new Date(dto.reviewAt) : undefined,
          arrangementStatus: 'COMPLETED',
        },
      });
      await tx.customerProfile.update({
        where: { id: application.customerProfileId },
        data: { creditStatus: CreditStatus.APPROVED },
      });

      await this.ledger.recordTransaction(tx, {
        creditProfileId: profile.id,
        customerProfileId: application.customerProfileId,
        type: CreditTransactionType.CREDIT_APPROVED,
        amount: approvedLimit,
        currency: application.currency,
        referenceType: 'APPLICATION',
        referenceId: id,
        createdById: actorUserId,
        source: 'ADMIN',
        notes: dto.reason ?? 'Credit application approved',
      });

      await this.ledger.refreshBalances(tx, profile.id);
    });

    await this.audit.log({
      action: partial
        ? 'CREDIT_APPLICATION_PARTIALLY_APPROVED'
        : 'CREDIT_APPLICATION_APPROVED',
      actorUserId,
      organizationId: application.customerProfile.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
      previousData: { status: application.status },
      newData: {
        status: nextStatus,
        approvedLimit: approvedLimit.toFixed(2),
        creditTermDays: termDays,
      },
    });

    const customerBody =
      dto.customerMessage?.trim() ||
      (partial
        ? `A partial credit limit of ${approvedLimit.toFixed(2)} has been approved.`
        : `Your credit limit of ${approvedLimit.toFixed(2)} has been approved.`);

    await this.timeline.record({
      creditApplicationId: id,
      eventType: partial
        ? CREDIT_APPLICATION_EVENT.PARTIALLY_APPROVED
        : CREDIT_APPLICATION_EVENT.APPROVED,
      description: customerBody,
      actorUserId,
      actorRole: 'ADMIN',
      customerVisible: true,
      metadata: {
        approvedLimit: approvedLimit.toFixed(2),
        creditTermDays: termDays,
      },
    });

    await this.notifications.create({
      userId: application.customerProfile.userId,
      organizationId: application.customerProfile.organizationId,
      title: partial
        ? 'PetroTrade credit partially approved'
        : 'PetroTrade credit approved',
      body: customerBody,
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
    });

    return this.getApplication(id);
  }

  async reject(id: string, actorUserId: string, dto: AdminCreditRejectDto) {
    const application = await this.requireApplication(id);
    if (TERMINAL_CREDIT_APPLICATION_STATUSES.includes(application.status)) {
      throw new BadRequestException(
        `Cannot reject application in ${application.status}`,
      );
    }
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('Rejection reason is required');
    }
    const customerMessage = dto.customerMessage?.trim() || reason;

    await this.prisma.$transaction(async (tx) => {
      await tx.creditApplication.update({
        where: { id },
        data: {
          status: CreditApplicationStatus.REJECTED,
          assignedAdminId: actorUserId,
          decidedAt: new Date(),
          decisionReason: reason,
          customerMessage,
        },
      });
      await tx.customerProfile.update({
        where: { id: application.customerProfileId },
        data: { creditStatus: CreditStatus.REJECTED },
      });
      await tx.customerCreditProfile.upsert({
        where: { customerProfileId: application.customerProfileId },
        update: { status: CreditStatus.REJECTED, notes: dto.reason },
        create: {
          customerProfileId: application.customerProfileId,
          status: CreditStatus.REJECTED,
          requestedLimit: application.requestedLimit,
          notes: dto.reason,
          accountNumber: await this.nextAccountNumber(tx),
        },
      });
    });

    await this.audit.log({
      action: 'CREDIT_APPLICATION_REJECTED',
      actorUserId,
      organizationId: application.customerProfile.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
      previousData: { status: application.status },
      newData: { status: CreditApplicationStatus.REJECTED, reason },
    });

    await this.timeline.record({
      creditApplicationId: id,
      eventType: CREDIT_APPLICATION_EVENT.REJECTED,
      description: customerMessage,
      actorUserId,
      actorRole: 'ADMIN',
      customerVisible: true,
    });

    await this.notifications.create({
      userId: application.customerProfile.userId,
      organizationId: application.customerProfile.organizationId,
      title: 'Credit application rejected',
      body: customerMessage,
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
    });

    return this.getApplication(id);
  }

  async sendInsuranceReview(
    id: string,
    actorUserId: string,
    dto: AdminCreditInsuranceReviewDto,
  ) {
    const application = await this.requireApplication(id);
    if (!OPEN_APPLICATION.includes(application.status)) {
      throw new BadRequestException(
        `Cannot send ${application.status} application to insurance review`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.creditApplication.update({
        where: { id },
        data: {
          status: CreditApplicationStatus.INSURANCE_REVIEW,
          assignedAdminId: actorUserId,
          insuranceStatus: 'IN_REVIEW',
          insurancePartner:
            dto.insurancePartner ?? application.insurancePartner,
          insuranceReference:
            dto.insuranceReference ?? application.insuranceReference,
          insuredAmount:
            dto.insuredAmount != null
              ? toDecimal(dto.insuredAmount)
              : undefined,
          customerMessage: dto.customerMessage ?? application.customerMessage,
          notes: dto.notes ?? application.notes,
        },
      });
      await tx.customerProfile.update({
        where: { id: application.customerProfileId },
        data: { creditStatus: CreditStatus.UNDER_REVIEW },
      });
    });

    await this.audit.log({
      action: CREDIT_APPLICATION_EVENT.INSURANCE_REVIEW_STARTED,
      actorUserId,
      organizationId: application.customerProfile.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
      previousData: { status: application.status },
      newData: {
        status: CreditApplicationStatus.INSURANCE_REVIEW,
        insurancePartner: dto.insurancePartner ?? null,
        insuranceReference: dto.insuranceReference ?? null,
      },
    });

    const customerBody =
      dto.customerMessage?.trim() ||
      'Your application is being reviewed by our credit insurance partner.';

    await this.timeline.record({
      creditApplicationId: id,
      eventType: CREDIT_APPLICATION_EVENT.INSURANCE_REVIEW_STARTED,
      description: customerBody,
      actorUserId,
      actorRole: 'ADMIN',
      customerVisible: true,
    });

    await this.notifications.create({
      userId: application.customerProfile.userId,
      organizationId: application.customerProfile.organizationId,
      title: 'Credit application update',
      body: customerBody,
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
    });

    return this.getApplication(id);
  }

  async markArrangementPending(
    id: string,
    actorUserId: string,
    dto: AdminCreditArrangementDto,
  ) {
    const application = await this.requireApplication(id);
    if (!OPEN_APPLICATION.includes(application.status)) {
      throw new BadRequestException(
        `Cannot move ${application.status} application to credit arrangement`,
      );
    }

    const insuredAmount =
      dto.insuredAmount != null ? toDecimal(dto.insuredAmount) : undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.creditApplication.update({
        where: { id },
        data: {
          status: CreditApplicationStatus.CREDIT_ARRANGEMENT_PENDING,
          assignedAdminId: actorUserId,
          arrangementStatus: 'IN_PROGRESS',
          insuranceStatus:
            dto.insuranceReference || dto.insurancePartner
              ? 'COMPLETED'
              : (application.insuranceStatus ?? 'NOT_STARTED'),
          insurancePartner:
            dto.insurancePartner ?? application.insurancePartner,
          insuranceReference:
            dto.insuranceReference ?? application.insuranceReference,
          insuredAmount,
          customerMessage: dto.customerMessage ?? application.customerMessage,
          notes: dto.notes ?? application.notes,
        },
      });

      const creditProfile = await tx.customerCreditProfile.findUnique({
        where: { customerProfileId: application.customerProfileId },
        select: { id: true },
      });
      if (creditProfile && (dto.insurancePartner || dto.insuranceReference)) {
        await tx.creditInsurance.upsert({
          where: { creditProfileId: creditProfile.id },
          update: {
            providerName: dto.insurancePartner,
            policyNumber: dto.insuranceReference,
            coverageAmount: insuredAmount,
            status: CreditInsuranceStatus.PENDING,
            notes: dto.notes,
          },
          create: {
            creditProfileId: creditProfile.id,
            customerProfileId: application.customerProfileId,
            providerName: dto.insurancePartner,
            policyNumber: dto.insuranceReference,
            coverageAmount: insuredAmount,
            status: CreditInsuranceStatus.PENDING,
            claimStatus: CreditInsuranceClaimStatus.NONE,
            notes: dto.notes,
          },
        });
      }
    });

    await this.audit.log({
      action: CREDIT_APPLICATION_EVENT.ARRANGEMENT_PENDING,
      actorUserId,
      organizationId: application.customerProfile.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
      previousData: { status: application.status },
      newData: { status: CreditApplicationStatus.CREDIT_ARRANGEMENT_PENDING },
    });

    const customerBody =
      dto.customerMessage?.trim() ||
      'Your credit arrangement is being finalised.';

    await this.timeline.record({
      creditApplicationId: id,
      eventType: CREDIT_APPLICATION_EVENT.ARRANGEMENT_PENDING,
      description: customerBody,
      actorUserId,
      actorRole: 'ADMIN',
      customerVisible: true,
    });

    await this.notifications.create({
      userId: application.customerProfile.userId,
      organizationId: application.customerProfile.organizationId,
      title: 'Credit application update',
      body: customerBody,
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
    });

    return this.getApplication(id);
  }

  async verifyApplicationDocument(
    id: string,
    documentId: string,
    actorUserId: string,
    dto: AdminCreditDocumentVerifyDto,
  ) {
    const application = await this.requireApplication(id);
    await this.requireApplicationDocument(application, documentId);
    const result = await this.documents.approve(documentId, actorUserId, {
      notes: dto.notes,
    });

    await this.audit.log({
      action: CREDIT_APPLICATION_EVENT.DOCUMENT_VERIFIED,
      actorUserId,
      organizationId: application.customerProfile.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
      newData: { documentId },
    });
    await this.timeline.record({
      creditApplicationId: id,
      eventType: CREDIT_APPLICATION_EVENT.DOCUMENT_VERIFIED,
      description: `${result.fileName} verified`,
      actorUserId,
      actorRole: 'ADMIN',
      customerVisible: true,
      metadata: { documentId },
    });

    return result;
  }

  async rejectApplicationDocument(
    id: string,
    documentId: string,
    actorUserId: string,
    dto: AdminCreditDocumentRejectDto,
  ) {
    const application = await this.requireApplication(id);
    await this.requireApplicationDocument(application, documentId);
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('Rejection reason is required');
    }
    const result = await this.documents.reject(documentId, actorUserId, {
      reason,
    });

    await this.audit.log({
      action: CREDIT_APPLICATION_EVENT.DOCUMENT_REJECTED,
      actorUserId,
      organizationId: application.customerProfile.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
      newData: { documentId, reason },
    });
    await this.timeline.record({
      creditApplicationId: id,
      eventType: CREDIT_APPLICATION_EVENT.DOCUMENT_REJECTED,
      description: `${result.fileName} rejected: ${reason}`,
      actorUserId,
      actorRole: 'ADMIN',
      customerVisible: true,
      metadata: { documentId, reason },
    });

    await this.notifications.create({
      userId: application.customerProfile.userId,
      organizationId: application.customerProfile.organizationId,
      title: 'Credit document rejected',
      body: `${result.fileName} was rejected: ${reason}. Please upload a replacement.`,
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
    });

    return result;
  }

  private async requireApplicationDocument(
    application: { id: string; customerProfile: { organizationId: string } },
    documentId: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        deletedAt: null,
        OR: [
          { ownerType: EntityOwnerType.CREDIT, ownerId: application.id },
          {
            organizationId: application.customerProfile.organizationId,
            category: { in: CREDIT_DOC_CATEGORIES },
          },
        ],
      },
      select: { id: true },
    });
    if (!doc) {
      throw new NotFoundException(
        'Document not found for this credit application',
      );
    }
    return doc;
  }

  async listAccounts(query: AdminCreditAccountsQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.CustomerCreditProfileWhereInput = {};
    if (query.status) where.accountStatus = query.status;
    if (query.customerId) where.customerProfileId = query.customerId;
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { accountNumber: { contains: search, mode: 'insensitive' } },
        {
          customerProfile: {
            organization: { name: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.customerCreditProfile.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
        include: {
          customerProfile: { select: CREDIT_CUSTOMER_SELECT },
          assignedAdmin: { select: ADMIN_SELECT },
          insurance: true,
        },
      }),
      this.prisma.customerCreditProfile.count({ where }),
    ]);

    return {
      items: rows.map((row) => mapAccount(row)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getAccount(id: string) {
    await this.requireAccount(id);
    await this.ledger.refreshBalances(this.prisma, id);
    const refreshed = await this.requireAccount(id);

    const [transactions, schedules, documents, audit, purchaseOrders] =
      await Promise.all([
        this.prisma.creditTransaction.findMany({
          where: { creditProfileId: id },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            createdBy: { select: ADMIN_SELECT },
            customerProfile: { select: CREDIT_CUSTOMER_SELECT },
            creditProfile: { select: { id: true, accountNumber: true } },
          },
        }),
        this.listAccountSchedules(refreshed.customerProfile.organizationId, id),
        this.prisma.document.findMany({
          where: {
            deletedAt: null,
            organizationId: refreshed.customerProfile.organization.id,
            category: { in: CREDIT_DOC_CATEGORIES },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            organization: { select: { id: true, name: true, legalName: true } },
          },
        }),
        this.prisma.auditLog.findMany({
          where: {
            OR: [
              { entityType: EntityOwnerType.CREDIT, entityId: id },
              {
                entityType: EntityOwnerType.CUSTOMER,
                entityId: refreshed.customerProfileId,
                action: { startsWith: 'CREDIT_' },
              },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { actor: { select: ADMIN_SELECT } },
        }),
        this.prisma.purchaseOrder.findMany({
          where: {
            customerOrgId: refreshed.customerProfile.organizationId,
            deletedAt: null,
            paymentMethod: { in: CREDIT_METHODS },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            paymentSchedules: { orderBy: { sequence: 'asc' } },
          },
        }),
      ]);

    return {
      ...mapAccount(refreshed),
      transactions: transactions.map((item) => mapTransaction(item)),
      repayments: schedules,
      documents: documents.map((doc) => mapDocument(doc)),
      audit: audit.map((item) => mapAuditEvent(item)),
      purchaseOrders: purchaseOrders.map((po) => ({
        id: po.id,
        referenceNumber: po.referenceNumber,
        paymentMethod: po.paymentMethod,
        paymentMethodLabel: 'Credit — PetroTrade Managed',
        totalAmount: toDecimal(po.totalAmount).toFixed(2),
        status: po.status,
        createdAt: po.createdAt,
        schedules: po.paymentSchedules.map((schedule) => ({
          id: schedule.id,
          sequence: schedule.sequence,
          type: schedule.type,
          amount: toDecimal(schedule.amount).toFixed(2),
          paidAmount: toDecimal(schedule.paidAmount).toFixed(2),
          remainingAmount: toDecimal(schedule.remainingAmount).toFixed(2),
          dueAt: schedule.dueAt,
          status: schedule.status,
          milestone: schedule.milestone,
        })),
      })),
      storage: {
        configured: this.storage.isConfigured(),
        pending: !this.storage.isConfigured(),
      },
    };
  }

  async adjustLimit(
    id: string,
    actorUserId: string,
    dto: AdminCreditAdjustLimitDto,
  ) {
    const account = await this.requireAccount(id);
    if (account.accountStatus === CreditAccountStatus.CLOSED) {
      throw new BadRequestException('Cannot adjust a closed credit account');
    }
    const previous = toDecimal(account.approvedLimit);
    const next = toDecimal(dto.newLimit);
    if (cmp(next, previous) === 0) {
      throw new BadRequestException('New limit matches the current limit');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.customerCreditProfile.update({
        where: { id: account.id },
        data: {
          approvedLimit: next,
          assignedAdminId: actorUserId,
          notes: dto.reason,
        },
      });
      await this.ledger.recordTransaction(tx, {
        creditProfileId: account.id,
        customerProfileId: account.customerProfileId,
        type: CreditTransactionType.CREDIT_LIMIT_ADJUSTED,
        amount: next,
        currency: account.currency,
        referenceType: 'ACCOUNT',
        referenceId: account.id,
        createdById: actorUserId,
        source: 'ADMIN',
        notes: dto.reason,
        metadata: {
          previousLimit: previous.toFixed(2),
          newLimit: next.toFixed(2),
        },
      });
      await this.ledger.refreshBalances(tx, account.id);
    });

    await this.audit.log({
      action: 'CREDIT_LIMIT_ADJUSTED',
      actorUserId,
      organizationId: account.customerProfile.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
      previousData: { approvedLimit: previous.toFixed(2) },
      newData: { approvedLimit: next.toFixed(2), reason: dto.reason },
    });

    return this.getAccount(id);
  }

  async suspend(
    id: string,
    actorUserId: string,
    dto: AdminCreditAccountActionDto,
  ) {
    const account = await this.requireAccount(id);
    if (account.accountStatus === CreditAccountStatus.SUSPENDED) {
      throw new BadRequestException('Credit account is already suspended');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.customerCreditProfile.update({
        where: { id: account.id },
        data: {
          status: CreditStatus.SUSPENDED,
          accountStatus: CreditAccountStatus.SUSPENDED,
          assignedAdminId: actorUserId,
          notes: dto.reason,
        },
      });
      await tx.customerProfile.update({
        where: { id: account.customerProfileId },
        data: { creditStatus: CreditStatus.SUSPENDED },
      });
      await this.ledger.recordTransaction(tx, {
        creditProfileId: id,
        customerProfileId: account.customerProfileId,
        type: CreditTransactionType.CREDIT_SUSPENDED,
        amount: 0,
        currency: account.currency,
        referenceType: 'ACCOUNT',
        referenceId: id,
        createdById: actorUserId,
        source: 'ADMIN',
        notes: dto.reason,
      });
    });

    await this.audit.log({
      action: 'CREDIT_ACCOUNT_SUSPENDED',
      actorUserId,
      organizationId: account.customerProfile.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
      previousData: { accountStatus: account.accountStatus },
      newData: {
        accountStatus: CreditAccountStatus.SUSPENDED,
        reason: dto.reason,
      },
    });

    return this.getAccount(account.id);
  }

  async reactivate(
    id: string,
    actorUserId: string,
    dto: AdminCreditAccountActionDto,
  ) {
    const account = await this.requireAccount(id);
    if (
      account.status !== CreditStatus.APPROVED &&
      account.status !== CreditStatus.SUSPENDED
    ) {
      throw new BadRequestException(
        'Only approved or suspended credit accounts can be reactivated',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.customerCreditProfile.update({
        where: { id: account.id },
        data: {
          status: CreditStatus.APPROVED,
          accountStatus: CreditAccountStatus.ACTIVE,
          assignedAdminId: actorUserId,
          notes: dto.reason,
        },
      });
      await tx.customerProfile.update({
        where: { id: account.customerProfileId },
        data: { creditStatus: CreditStatus.APPROVED },
      });
    });

    await this.audit.log({
      action: 'CREDIT_ACCOUNT_REACTIVATED',
      actorUserId,
      organizationId: account.customerProfile.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: id,
      previousData: { accountStatus: account.accountStatus },
      newData: {
        accountStatus: CreditAccountStatus.ACTIVE,
        reason: dto.reason,
      },
    });

    return this.getAccount(account.id);
  }

  async listUtilization(query: AdminCreditAccountsQueryDto) {
    return this.listAccounts(query);
  }

  async listTransactions(query: AdminCreditTransactionsQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.CreditTransactionWhereInput = {};
    if (query.type) where.type = query.type;
    if (query.accountId) where.creditProfileId = query.accountId;
    if (query.customerId) where.customerProfileId = query.customerId;
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { transactionNumber: { contains: search, mode: 'insensitive' } },
        { referenceId: { contains: search, mode: 'insensitive' } },
        {
          customerProfile: {
            organization: { name: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.creditTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          customerProfile: { select: CREDIT_CUSTOMER_SELECT },
          creditProfile: { select: { id: true, accountNumber: true } },
          createdBy: { select: ADMIN_SELECT },
        },
      }),
      this.prisma.creditTransaction.count({ where }),
    ]);

    return {
      items: rows.map((row) => mapTransaction(row)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async listRepayments(query: AdminCreditRepaymentsQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const accountFilter = query.accountId
      ? { id: query.accountId }
      : query.customerId
        ? { customerProfileId: query.customerId }
        : {};
    const accounts = await this.prisma.customerCreditProfile.findMany({
      where: accountFilter,
      include: { customerProfile: { select: CREDIT_CUSTOMER_SELECT } },
    });
    const orgIds = accounts.map((row) => row.customerProfile.organization.id);
    if (orgIds.length === 0) {
      return { items: [], meta: paginationMeta(page, limit, 0) };
    }
    const accountByOrg = new Map(
      accounts.map((row) => [row.customerProfile.organization.id, row]),
    );

    const where: Prisma.PaymentScheduleWhereInput = {
      purchaseOrder: {
        deletedAt: null,
        paymentMethod: { in: CREDIT_METHODS },
        customerOrgId: { in: orgIds },
      },
    };
    const search = query.search?.trim();
    if (search) {
      where.purchaseOrder = {
        ...(where.purchaseOrder as Prisma.PurchaseOrderWhereInput),
        OR: [
          { referenceNumber: { contains: search, mode: 'insensitive' } },
          {
            customerOrg: { name: { contains: search, mode: 'insensitive' } },
          },
        ],
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.paymentSchedule.findMany({
        where,
        orderBy: { dueAt: 'asc' },
        skip,
        take,
        include: {
          purchaseOrder: {
            select: {
              id: true,
              referenceNumber: true,
              paymentMethod: true,
              customerOrgId: true,
            },
          },
          payments: {
            where: { verifiedAt: { not: null } },
            orderBy: { verifiedAt: 'desc' },
            take: 1,
            select: { verifiedAt: true },
          },
        },
      }),
      this.prisma.paymentSchedule.count({ where }),
    ]);

    return {
      items: rows.flatMap((row) => {
        const account = accountByOrg.get(row.purchaseOrder.customerOrgId);
        if (!account) return [];
        return [
          mapRepayment({
            schedule: row,
            purchaseOrder: row.purchaseOrder,
            customer: account.customerProfile,
            account,
            paidAt: row.payments[0]?.verifiedAt ?? null,
          }),
        ];
      }),
      meta: paginationMeta(page, limit, total),
    };
  }

  async listInsurance(query: AdminCreditAccountsQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.CreditInsuranceWhereInput = {};
    if (query.customerId) where.customerProfileId = query.customerId;
    const [rows, total] = await Promise.all([
      this.prisma.creditInsurance.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
        include: {
          customerProfile: { select: CREDIT_CUSTOMER_SELECT },
          creditProfile: { select: { id: true, accountNumber: true } },
        },
      }),
      this.prisma.creditInsurance.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        ...mapInsurance(row, row.customerProfile),
        accountNumber: row.creditProfile.accountNumber,
      })),
      meta: paginationMeta(page, limit, total),
    };
  }

  async updateInsurance(
    accountId: string,
    actorUserId: string,
    dto: AdminCreditInsuranceUpdateDto,
  ) {
    const account = await this.requireAccount(accountId);
    const record = await this.prisma.creditInsurance.upsert({
      where: { creditProfileId: accountId },
      update: {
        status: dto.status,
        claimStatus: dto.claimStatus,
        providerName: dto.providerName,
        policyNumber: dto.policyNumber,
        coverageAmount:
          dto.coverageAmount != null
            ? toDecimal(dto.coverageAmount)
            : undefined,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        notes: dto.notes,
      },
      create: {
        creditProfileId: accountId,
        customerProfileId: account.customerProfileId,
        status: dto.status ?? CreditInsuranceStatus.PENDING,
        claimStatus: dto.claimStatus ?? CreditInsuranceClaimStatus.NONE,
        providerName: dto.providerName,
        policyNumber: dto.policyNumber,
        coverageAmount:
          dto.coverageAmount != null
            ? toDecimal(dto.coverageAmount)
            : undefined,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        notes: dto.notes,
      },
    });

    await this.audit.log({
      action: 'CREDIT_INSURANCE_UPDATED',
      actorUserId,
      organizationId: account.customerProfile.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: accountId,
      newData: {
        status: record.status,
        providerIntegration: 'PENDING',
      },
    });

    return {
      ...mapInsurance(record, account.customerProfile),
      accountNumber: account.accountNumber,
    };
  }

  async listDocuments(query: AdminCreditDocumentsQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    let organizationIds: string[] | undefined;
    if (query.accountId) {
      const account = await this.requireAccount(query.accountId);
      organizationIds = [account.customerProfile.organizationId];
    } else if (query.customerId) {
      const profile = await this.prisma.customerProfile.findUnique({
        where: { id: query.customerId },
        select: { organizationId: true },
      });
      organizationIds = profile ? [profile.organizationId] : [];
    }

    const where: Prisma.DocumentWhereInput = {
      deletedAt: null,
      category: query.category ?? { in: CREDIT_DOC_CATEGORIES },
      ...(organizationIds ? { organizationId: { in: organizationIds } } : {}),
    };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { fileName: { contains: search, mode: 'insensitive' } },
        { documentNumber: { contains: search, mode: 'insensitive' } },
        { storageKey: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          organization: { select: { id: true, name: true, legalName: true } },
        },
      }),
      this.prisma.document.count({ where }),
    ]);

    return {
      items: rows.map((row) => mapDocument(row)),
      meta: paginationMeta(page, limit, total),
      storage: {
        configured: this.storage.isConfigured(),
        pending: !this.storage.isConfigured(),
      },
    };
  }

  async requestDocument(
    accountId: string,
    actorUserId: string,
    dto: AdminCreditRequestDocumentDto,
  ) {
    const account = await this.requireAccount(accountId);
    const created = await this.prisma.document.create({
      data: {
        organizationId: account.customerProfile.organizationId,
        uploadedById: actorUserId,
        ownerType: EntityOwnerType.CUSTOMER,
        ownerId: account.customerProfileId,
        category: dto.category,
        fileName: `requested-${dto.category.toLowerCase()}.pdf`,
        mimeType: 'application/pdf',
        fileSizeBytes: BigInt(1),
        storageProvider: StorageProvider.NONE,
        storageKey: `pending/credit/${accountId}/${randomUUID()}`,
        metadata: {
          requested: true,
          storagePending: true,
          notes: dto.notes ?? null,
          creditAccountId: accountId,
        },
      },
    });

    await this.audit.log({
      action: 'CREDIT_DOCUMENT_REQUESTED',
      actorUserId,
      organizationId: account.customerProfile.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: accountId,
      newData: { category: dto.category, documentId: created.id },
    });

    await this.notifications.create({
      userId: account.customerProfile.userId,
      organizationId: account.customerProfile.organizationId,
      title: 'Credit document requested',
      body:
        dto.notes?.trim() ||
        `Please upload ${dto.category} for PetroTrade credit review.`,
      entityType: EntityOwnerType.CREDIT,
      entityId: accountId,
    });

    return {
      id: created.id,
      category: created.category,
      fileName: created.fileName,
      storageKey: created.storageKey,
      storagePending: true,
      storageConfigured: this.storage.isConfigured(),
    };
  }

  async downloadDocument(id: string) {
    if (!this.storage.isConfigured()) {
      const doc = await this.prisma.document.findFirst({
        where: { id, deletedAt: null },
      });
      if (!doc) throw new NotFoundException('Document not found');
      return {
        id: doc.id,
        fileName: doc.fileName,
        storageKey: doc.storageKey,
        storageConfigured: false,
        storagePending: true,
        url: null,
      };
    }
    const payload = await this.documents.download(id);
    return { ...payload, storageConfigured: true, storagePending: false };
  }

  async listAudit(query: AdminCreditAuditQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.AuditLogWhereInput = {
      action: { startsWith: 'CREDIT_' },
    };
    if (query.accountId || query.applicationId) {
      where.entityId = query.accountId ?? query.applicationId;
    }
    if (query.customerId) {
      const profile = await this.prisma.customerProfile.findUnique({
        where: { id: query.customerId },
        select: { organizationId: true },
      });
      if (profile) where.organizationId = profile.organizationId;
    }

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { actor: { select: ADMIN_SELECT } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map((row) => mapAuditEvent(row)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getCustomerCredit(customerProfileId: string) {
    const account = await this.prisma.customerCreditProfile.findFirst({
      where: { customerProfileId },
      include: {
        customerProfile: { select: CREDIT_CUSTOMER_SELECT },
        assignedAdmin: { select: ADMIN_SELECT },
        insurance: true,
      },
    });
    const application = await this.prisma.creditApplication.findFirst({
      where: { customerProfileId },
      orderBy: { createdAt: 'desc' },
    });
    if (!account) {
      return {
        customerId: customerProfileId,
        applicationStatus: application?.status ?? 'NOT_APPLIED',
        account: null,
      };
    }
    await this.ledger.refreshBalances(this.prisma, account.id);
    const refreshed = await this.requireAccount(account.id);
    return {
      customerId: customerProfileId,
      applicationStatus: application?.status ?? refreshed.status,
      account: mapAccount(refreshed),
    };
  }

  private async listAccountSchedules(
    organizationId: string,
    accountId: string,
  ) {
    const account = await this.requireAccount(accountId);
    const rows = await this.prisma.paymentSchedule.findMany({
      where: {
        purchaseOrder: {
          customerOrgId: organizationId,
          deletedAt: null,
          paymentMethod: { in: CREDIT_METHODS },
        },
      },
      orderBy: { dueAt: 'asc' },
      include: {
        purchaseOrder: {
          select: {
            id: true,
            referenceNumber: true,
            paymentMethod: true,
            customerOrgId: true,
          },
        },
        payments: {
          where: { verifiedAt: { not: null } },
          orderBy: { verifiedAt: 'desc' },
          take: 1,
          select: { verifiedAt: true },
        },
      },
    });
    return rows.map((row) =>
      mapRepayment({
        schedule: row,
        purchaseOrder: row.purchaseOrder,
        customer: account.customerProfile,
        account,
        paidAt: row.payments[0]?.verifiedAt ?? null,
      }),
    );
  }

  private async requireApplication(id: string) {
    const row = await this.prisma.creditApplication.findUnique({
      where: { id },
      include: { customerProfile: true },
    });
    if (!row) throw new NotFoundException('Credit application not found');
    return row;
  }

  async exposure(query: AdminCreditAccountsQueryDto) {
    const { items, meta } = await this.listAccounts(query);
    const totals = items.reduce(
      (acc, row) => {
        acc.approved += Number(row.approvedLimit);
        acc.available += Number(row.availableLimit);
        acc.pending += Number(row.pendingCredit);
        acc.outstanding += Number(row.outstandingAmount);
        acc.overdue += Number(row.overdueAmount);
        return acc;
      },
      {
        approved: 0,
        available: 0,
        pending: 0,
        outstanding: 0,
        overdue: 0,
      },
    );
    return {
      accounts: items,
      totals: {
        approvedLimit: totals.approved.toFixed(2),
        availableCredit: totals.available.toFixed(2),
        pendingCredit: totals.pending.toFixed(2),
        outstandingAmount: totals.outstanding.toFixed(2),
        overdueAmount: totals.overdue.toFixed(2),
      },
      meta,
    };
  }

  async outstanding(query: AdminCreditAccountsQueryDto) {
    const { items, meta } = await this.listAccounts(query);
    return {
      items: items.filter((row) => Number(row.outstandingAmount) > 0),
      meta,
    };
  }

  private async requireAccount(id: string) {
    const row = await this.prisma.customerCreditProfile.findFirst({
      where: {
        OR: [{ id }, { customerProfileId: id }],
      },
      include: {
        customerProfile: { select: CREDIT_CUSTOMER_SELECT },
        assignedAdmin: { select: ADMIN_SELECT },
        insurance: true,
      },
    });
    if (!row) throw new NotFoundException('Credit account not found');
    return row;
  }

  private async nextAccountNumber(
    tx: Prisma.TransactionClient | PrismaService,
  ) {
    return generateUniqueCreditRef(
      async (candidate) =>
        Boolean(
          await tx.customerCreditProfile.findUnique({
            where: { accountNumber: candidate },
            select: { id: true },
          }),
        ),
      'CR',
    );
  }

  private async ensureAccountNumber(
    tx: Prisma.TransactionClient | PrismaService,
    customerProfileId: string,
  ) {
    const existing = await tx.customerCreditProfile.findUnique({
      where: { customerProfileId },
      select: { accountNumber: true },
    });
    return existing?.accountNumber ?? this.nextAccountNumber(tx);
  }
}
