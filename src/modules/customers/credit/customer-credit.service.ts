import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreditApplicationStatus,
  CreditStatus,
  DocumentStatus,
  EntityOwnerType,
  Prisma,
  type CreditApplication,
  type Document,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import type { ResolvedClientSource } from '../../../common/utils/client-source.js';
import {
  generateUniqueCreditApplicationNumber,
  isUniqueViolationOn,
} from '../../payments/common/credit-number.js';
import { toDecimal } from '../../payments/common/money.util.js';
import {
  CREDIT_APPLICATION_EVENT,
  CREDIT_APPLICATION_SOURCE_LABELS,
  assertCreditTransition,
  creditDisplayStatus,
  humanizeCreditStatus,
  isResubmissionRequested,
  CREDIT_DOCUMENT_TYPE_LABELS,
  CREDIT_DOCUMENT_UPLOAD_STATUSES,
  OPEN_CREDIT_APPLICATION_STATUSES,
  REQUIRED_CREDIT_DOCUMENT_TYPES,
  creditDocumentCategory,
  creditNextStep,
  type CreditApplicationDocumentType,
} from '../../payments/common/credit-workflow.js';
import { utilizationPercentage } from '../../payments/services/credit-ledger.service.js';
import { CreditTimelineService } from '../../payments/services/credit-timeline.service.js';
import { DocumentsCoreService } from '../../documents/services/documents-core.service.js';
import { NotificationService } from '../../notifications/notification.service.js';
import { StorageService } from '../../../storage/storage.service.js';
import { CustomerAuditService } from '../common/customer-audit.service.js';
import { CustomerContextService } from '../common/customer-context.service.js';
import { CreditEligibilityService } from '../../payments/services/credit-eligibility.service.js';
import type {
  CustomerCreditApplyDto,
  CustomerCreditDocumentReplaceDto,
  CustomerCreditDocumentUploadDto,
  CustomerCreditDraftDto,
  CustomerCreditResubmitDocumentsDto,
} from './customer-credit.dto.js';

const OPEN = OPEN_CREDIT_APPLICATION_STATUSES;

/** Keys the server owns; clients cannot set them through free-form metadata. */
const RESERVED_METADATA_KEYS = new Set([
  'source',
  'channel',
  'status',
  'applicationNumber',
  'customerId',
  'customerProfileId',
  'userId',
  'kycStatus',
  'approved',
  'approvedLimit',
  'assignedAdminId',
]);

function sanitizeClientMetadata(
  metadata: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) => !RESERVED_METADATA_KEYS.has(key),
    ),
  ) as Prisma.InputJsonValue;
}

const ADMIN_NOTIFY_ROLES = [
  RoleCode.ADMIN,
  RoleCode.SUPER_ADMIN,
  RoleCode.FINANCE_MANAGER,
];

@Injectable()
export class CustomerCreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: CustomerContextService,
    private readonly audit: CustomerAuditService,
    private readonly notifications: NotificationService,
    private readonly creditEligibility: CreditEligibilityService,
    private readonly documents: DocumentsCoreService,
    private readonly timeline: CreditTimelineService,
    private readonly storage: StorageService,
  ) {}

  async getAccount(userId: string) {
    const ctx = await this.context.requireCustomer(userId);
    const [account, application] = await Promise.all([
      this.prisma.customerCreditProfile.findUnique({
        where: { customerProfileId: ctx.customerProfileId },
      }),
      this.prisma.creditApplication.findFirst({
        where: { customerProfileId: ctx.customerProfileId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      customerId: ctx.customerProfileId,
      application: application
        ? {
            id: application.id,
            applicationNumber: application.applicationNumber,
            status: application.status,
            requestedLimit: toDecimal(application.requestedLimit).toFixed(2),
            requestedTenureDays: application.requestedTenureDays,
            purpose: application.purpose,
            submittedAt: application.submittedAt,
            createdAt: application.createdAt,
            updatedAt: application.updatedAt,
          }
        : null,
      account: account ? this.mapAccount(account) : null,
    };
  }

  async getStatus(userId: string) {
    const snapshot = await this.getAccount(userId);
    return {
      customerId: snapshot.customerId,
      applicationStatus: snapshot.application?.status ?? 'NOT_APPLIED',
      accountStatus: snapshot.account?.accountStatus ?? null,
      creditStatus: snapshot.account?.status ?? CreditStatus.NOT_APPLIED,
      displayStatus: this.displayStatus(snapshot),
    };
  }

  async getLimit(userId: string) {
    const snapshot = await this.getAccount(userId);
    return {
      customerId: snapshot.customerId,
      status: this.displayStatus(snapshot),
      approvedLimit: snapshot.account?.approvedLimit ?? '0.00',
      availableLimit: snapshot.account?.availableLimit ?? '0.00',
      pendingCredit: snapshot.account?.pendingCredit ?? '0.00',
      utilizedAmount: snapshot.account?.utilizedAmount ?? '0.00',
      outstandingAmount: snapshot.account?.outstandingAmount ?? '0.00',
      currency: snapshot.account?.currency ?? 'INR',
    };
  }

  async getSummary(userId: string) {
    const snapshot = await this.getAccount(userId);
    return {
      ...snapshot,
      status: this.displayStatus(snapshot),
    };
  }

  async getEligibility(userId: string) {
    const ctx = await this.context.requireCustomer(userId);
    const inspected = await this.creditEligibility.inspect(
      this.prisma,
      ctx.organizationId,
      0,
    );
    return {
      eligible: inspected.eligible,
      approvedLimit: inspected.approvedLimit,
      availableLimit: inspected.availableLimit,
      tenureOptions: inspected.tenureOptions,
      source: 'PETROTRADE',
    };
  }

  async listTransactions(userId: string) {
    const ctx = await this.context.requireCustomer(userId);
    const rows = await this.prisma.creditTransaction.findMany({
      where: { customerProfileId: ctx.customerProfileId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => ({
      id: row.id,
      transactionNumber: row.transactionNumber,
      type: row.type,
      status: row.status,
      amount: toDecimal(row.amount).toFixed(2),
      balanceBefore:
        row.balanceBefore != null
          ? toDecimal(row.balanceBefore).toFixed(2)
          : null,
      balanceAfter:
        row.balanceAfter != null
          ? toDecimal(row.balanceAfter).toFixed(2)
          : null,
      purchaseOrderId: row.purchaseOrderId,
      paymentId: row.paymentId,
      notes: row.notes,
      createdAt: row.createdAt,
    }));
  }

  // ---------------------------------------------------------------------------
  // Application lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Backward-compatible one-shot apply: creates an already-submitted
   * application. New clients should use saveDraft + documents + submit.
   */
  async apply(
    userId: string,
    dto: CustomerCreditApplyDto,
    client: ResolvedClientSource,
  ) {
    const ctx = await this.context.requireCustomer(userId);
    const requestedLimit = toDecimal(dto.requestedLimit);
    const submittedAt = new Date();

    const created = await this.withCustomerApplicationLock(
      ctx.customerProfileId,
      async (tx) => {
        const open = await this.findOpenApplication(tx, ctx.customerProfileId);
        if (open) {
          throw new BadRequestException(
            `An open credit application already exists (${open.applicationNumber})`,
          );
        }
        const application = await tx.creditApplication.create({
          data: {
            applicationNumber: await this.nextApplicationNumber(),
            customerProfileId: ctx.customerProfileId,
            status: CreditApplicationStatus.PENDING,
            source: client.source,
            requestedLimit,
            requestedTenureDays: dto.requestedTenureDays,
            purpose: dto.purpose,
            submittedAt,
            metadata: sanitizeClientMetadata(dto.metadata),
          },
        });
        await this.markCustomerPending(
          tx,
          ctx.customerProfileId,
          requestedLimit,
        );
        return application;
      },
    );

    await this.timeline.record({
      creditApplicationId: created.id,
      eventType: CREDIT_APPLICATION_EVENT.CREATED,
      description: 'Credit application created',
      actorUserId: userId,
      actorRole: 'CUSTOMER',
      customerVisible: true,
      metadata: this.channelMetadata(client),
    });
    await this.timeline.record({
      creditApplicationId: created.id,
      eventType: CREDIT_APPLICATION_EVENT.SUBMITTED,
      description: 'Credit application submitted for review',
      actorUserId: userId,
      actorRole: 'CUSTOMER',
      customerVisible: true,
      metadata: {
        requestedLimit: requestedLimit.toFixed(2),
        fromStatus: null,
        toStatus: CreditApplicationStatus.PENDING,
        ...this.channelMetadata(client),
      },
    });

    await this.audit.log({
      action: CREDIT_APPLICATION_EVENT.SUBMITTED,
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: created.id,
      newData: {
        applicationNumber: created.applicationNumber,
        status: created.status,
        source: created.source,
        requestedLimit: requestedLimit.toFixed(2),
      },
    });

    await this.notifySubmitted(created, ctx, userId, requestedLimit, false);

    return {
      id: created.id,
      applicationNumber: created.applicationNumber,
      status: created.status,
      source: created.source,
      requestedLimit: requestedLimit.toFixed(2),
      requestedTenureDays: created.requestedTenureDays,
      purpose: created.purpose,
      submittedAt: created.submittedAt,
      nextStep: creditNextStep(created.status),
      createdAt: created.createdAt,
    };
  }

  /** Create the open draft, or update it when one already exists. */
  async saveDraft(
    userId: string,
    dto: CustomerCreditDraftDto,
    client: ResolvedClientSource,
  ) {
    const ctx = await this.context.requireCustomer(userId);
    const requestedLimit = toDecimal(dto.requestedLimit);
    const metadata = sanitizeClientMetadata(dto.metadata);

    const { application, created } = await this.withCustomerApplicationLock(
      ctx.customerProfileId,
      async (tx) => {
        const open = await this.findOpenApplication(tx, ctx.customerProfileId);
        if (open && open.status !== CreditApplicationStatus.DRAFT) {
          throw new BadRequestException(
            `An open credit application already exists (${open.applicationNumber})`,
          );
        }

        if (open) {
          const updated = await tx.creditApplication.update({
            where: { id: open.id },
            data: {
              requestedLimit,
              requestedTenureDays: dto.requestedTenureDays ?? null,
              purpose: dto.purpose ?? null,
              metadata,
              // Drafts created before source tracking adopt the channel completing them.
              ...(open.source == null ? { source: client.source } : {}),
            },
          });
          return { application: updated, created: false };
        }

        const draft = await tx.creditApplication.create({
          data: {
            applicationNumber: await this.nextApplicationNumber(),
            customerProfileId: ctx.customerProfileId,
            status: CreditApplicationStatus.DRAFT,
            source: client.source,
            requestedLimit,
            requestedTenureDays: dto.requestedTenureDays,
            purpose: dto.purpose,
            metadata,
          },
        });
        return { application: draft, created: true };
      },
    );

    if (created) {
      await this.timeline.record({
        creditApplicationId: application.id,
        eventType: CREDIT_APPLICATION_EVENT.CREATED,
        description: 'Credit application draft created',
        actorUserId: userId,
        actorRole: 'CUSTOMER',
        customerVisible: true,
        metadata: this.channelMetadata(client),
      });
      await this.audit.log({
        action: CREDIT_APPLICATION_EVENT.CREATED,
        actorUserId: userId,
        organizationId: ctx.organizationId,
        entityType: EntityOwnerType.CREDIT,
        entityId: application.id,
        newData: {
          applicationNumber: application.applicationNumber,
          status: application.status,
          source: application.source,
          requestedLimit: requestedLimit.toFixed(2),
        },
      });
    }

    return this.buildApplicationView(application, ctx.customerProfileId);
  }

  /** The signed-in customer's applications, newest first, without internal fields. */
  async listApplications(userId: string) {
    const ctx = await this.context.requireCustomer(userId);
    const rows = await this.prisma.creditApplication.findMany({
      where: { customerProfileId: ctx.customerProfileId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => {
      const resubmissionRequested = isResubmissionRequested(row);
      return {
        id: row.id,
        applicationNumber: row.applicationNumber,
        status: row.status,
        displayStatus: creditDisplayStatus(row),
        resubmissionRequested,
        requestedLimit: toDecimal(row.requestedLimit).toFixed(2),
        approvedLimit:
          row.approvedLimit != null
            ? toDecimal(row.approvedLimit).toFixed(2)
            : null,
        currency: row.currency,
        customerMessage: row.customerMessage,
        submittedAt: row.submittedAt,
        decidedAt: row.decidedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        nextStep: creditNextStep(row.status, { resubmissionRequested }),
      };
    });
  }

  async getApplication(userId: string, id: string) {
    const { ctx, application } = await this.requireOwnApplication(userId, id);
    return this.buildApplicationView(application, ctx.customerProfileId, {
      includeTimeline: true,
    });
  }

  /** Latest application for the signed-in customer, or null. */
  async getLatestApplication(userId: string) {
    const ctx = await this.context.requireCustomer(userId);
    const application = await this.prisma.creditApplication.findFirst({
      where: { customerProfileId: ctx.customerProfileId },
      orderBy: { createdAt: 'desc' },
    });
    if (!application) return null;
    return this.buildApplicationView(application, ctx.customerProfileId, {
      includeTimeline: true,
    });
  }

  async getApplicationStatus(userId: string, id: string) {
    const { application } = await this.requireOwnApplication(userId, id);
    const missing = await this.missingRequiredDocuments(application.id);
    return {
      id: application.id,
      applicationNumber: application.applicationNumber,
      status: application.status,
      insuranceStatus: application.insuranceStatus,
      arrangementStatus: application.arrangementStatus,
      customerMessage: application.customerMessage,
      submittedAt: application.submittedAt,
      decidedAt: application.decidedAt,
      approvedLimit:
        application.approvedLimit != null
          ? toDecimal(application.approvedLimit).toFixed(2)
          : null,
      approvedTenureDays: application.approvedTenureDays,
      missingDocuments: missing,
      displayStatus: creditDisplayStatus(application),
      resubmissionRequested: isResubmissionRequested(application),
      canSubmit:
        application.status === CreditApplicationStatus.DRAFT &&
        missing.length === 0,
      nextStep: creditNextStep(application.status, {
        resubmissionRequested: isResubmissionRequested(application),
      }),
    };
  }

  async getTimeline(userId: string, id: string) {
    const { application } = await this.requireOwnApplication(userId, id);
    return this.timeline.list(application.id, { customerVisibleOnly: true });
  }

  /**
   * Submits a draft. Idempotent: repeating the call (double click, network
   * retry) after a successful submit returns the same result instead of an
   * error, and concurrent calls can only move the draft once.
   */
  async submit(userId: string, id: string, client: ResolvedClientSource) {
    const { ctx, application } = await this.requireOwnApplication(userId, id);
    if (application.status !== CreditApplicationStatus.DRAFT) {
      if (application.status === CreditApplicationStatus.PENDING) {
        return this.submitResult(application, true);
      }
      throw new BadRequestException(
        `This application was already submitted and is now ${humanizeCreditStatus(application.status)}`,
      );
    }

    const missing = await this.missingRequiredDocuments(application.id);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Upload the required documents before submitting: ${missing
          .map((item) => item.label)
          .join(', ')}`,
      );
    }

    const resubmission = isResubmissionRequested(application);
    const requestedLimit = toDecimal(application.requestedLimit);
    const submittedAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.creditApplication.updateMany({
        where: { id: application.id, status: CreditApplicationStatus.DRAFT },
        data: {
          status: CreditApplicationStatus.PENDING,
          submittedAt,
          ...(resubmission ? { customerMessage: null } : {}),
        },
      });
      if (moved.count === 0) return null;
      await this.markCustomerPending(tx, ctx.customerProfileId, requestedLimit);
      return tx.creditApplication.findUniqueOrThrow({
        where: { id: application.id },
      });
    });

    if (!updated) {
      const current = await this.prisma.creditApplication.findUnique({
        where: { id: application.id },
      });
      if (current?.status === CreditApplicationStatus.PENDING) {
        return this.submitResult(current, true);
      }
      throw new ConflictException(
        'This application changed while you were submitting. Refresh and try again.',
      );
    }

    await this.timeline.record({
      creditApplicationId: application.id,
      eventType: CREDIT_APPLICATION_EVENT.SUBMITTED,
      description: resubmission
        ? 'Credit application resubmitted for review'
        : 'Credit application submitted for review',
      actorUserId: userId,
      actorRole: 'CUSTOMER',
      customerVisible: true,
      metadata: {
        requestedLimit: requestedLimit.toFixed(2),
        fromStatus: CreditApplicationStatus.DRAFT,
        toStatus: CreditApplicationStatus.PENDING,
        resubmission,
        ...this.channelMetadata(client),
      },
    });
    await this.audit.log({
      action: CREDIT_APPLICATION_EVENT.SUBMITTED,
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: application.id,
      previousData: { status: CreditApplicationStatus.DRAFT },
      newData: {
        status: CreditApplicationStatus.PENDING,
        source: updated.source,
        requestedLimit: requestedLimit.toFixed(2),
        resubmission,
      },
    });

    await this.notifySubmitted(
      updated,
      ctx,
      userId,
      requestedLimit,
      resubmission,
    );

    return this.submitResult(updated, false);
  }

  private submitResult(
    application: CreditApplication,
    alreadySubmitted: boolean,
  ) {
    return {
      id: application.id,
      applicationNumber: application.applicationNumber,
      status: application.status,
      source: application.source,
      submittedAt: application.submittedAt,
      alreadySubmitted,
      message:
        'Your credit request has been submitted successfully. Our team will review your application and contact you.',
      nextStep: creditNextStep(application.status),
    };
  }

  private async notifySubmitted(
    application: CreditApplication,
    ctx: { organizationId: string; organizationName: string },
    userId: string,
    requestedLimit: Prisma.Decimal,
    resubmission: boolean,
  ) {
    const channel = application.source
      ? CREDIT_APPLICATION_SOURCE_LABELS[application.source]
      : null;
    const title = resubmission
      ? 'Credit application resubmitted'
      : channel
        ? `New credit application from ${channel}`
        : 'New credit application';
    await this.notifyAdmins(
      application.id,
      title,
      `${ctx.organizationName} requested credit of INR ${requestedLimit.toFixed(2)} (${application.applicationNumber}).`,
    );
    await this.notifications.create({
      userId,
      organizationId: ctx.organizationId,
      title: resubmission
        ? 'Credit application resubmitted'
        : 'Credit application submitted',
      body: `Application ${application.applicationNumber} has been received. Our credit team will review it and contact you.`,
      entityType: EntityOwnerType.CREDIT,
      entityId: application.id,
    });
  }

  /** Request channel details safe to keep on the timeline (no IPs or tokens). */
  private channelMetadata(client: ResolvedClientSource) {
    return {
      channel: client.source,
      ...(client.unrecognizedOrigin && client.origin
        ? { unrecognizedOrigin: client.origin }
        : {}),
    };
  }

  /**
   * Runs `fn` in a transaction holding a per-customer advisory lock so two
   * concurrent requests cannot both create an open application. Retries when
   * a generated application number collides with the unique constraint.
   */
  private async withCustomerApplicationLock<T>(
    customerProfileId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const lockKey = `credit-application:${customerProfileId}`;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS locked`;
          return fn(tx);
        });
      } catch (error) {
        if (
          attempt < 3 &&
          isUniqueViolationOn(error, [
            'applicationNumber',
            'application_number',
          ])
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  /** Customer signals that requested documents have been re-uploaded. */
  async resubmitDocuments(
    userId: string,
    id: string,
    dto: CustomerCreditResubmitDocumentsDto,
  ) {
    const { ctx, application } = await this.requireOwnApplication(userId, id);
    if (application.status !== CreditApplicationStatus.DOCUMENTS_REQUIRED) {
      throw new BadRequestException(
        `Cannot resubmit documents from ${application.status}`,
      );
    }

    assertCreditTransition(
      application.status,
      CreditApplicationStatus.DOCUMENTS_UNDER_REVIEW,
    );
    const moved = await this.prisma.creditApplication.updateMany({
      where: {
        id: application.id,
        status: CreditApplicationStatus.DOCUMENTS_REQUIRED,
      },
      data: { status: CreditApplicationStatus.DOCUMENTS_UNDER_REVIEW },
    });
    if (moved.count === 0) {
      throw new ConflictException(
        'This application changed while you were resubmitting. Refresh and try again.',
      );
    }
    const updated = await this.prisma.creditApplication.findUniqueOrThrow({
      where: { id: application.id },
    });

    await this.timeline.record({
      creditApplicationId: application.id,
      eventType: CREDIT_APPLICATION_EVENT.DOCUMENTS_RESUBMITTED,
      description: 'Requested documents resubmitted',
      actorUserId: userId,
      actorRole: 'CUSTOMER',
      customerVisible: true,
      metadata: {
        fromStatus: application.status,
        toStatus: updated.status,
        ...(dto.message ? { message: dto.message } : {}),
      },
    });
    await this.audit.log({
      action: CREDIT_APPLICATION_EVENT.DOCUMENTS_RESUBMITTED,
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: application.id,
      previousData: { status: application.status },
      newData: { status: updated.status },
    });
    await this.notifyAdmins(
      application.id,
      'Credit documents resubmitted',
      `${ctx.organizationName} resubmitted documents for ${application.applicationNumber}.`,
    );

    return {
      id: updated.id,
      applicationNumber: updated.applicationNumber,
      status: updated.status,
      nextStep: creditNextStep(updated.status),
    };
  }

  // ---------------------------------------------------------------------------
  // Application documents
  // ---------------------------------------------------------------------------

  async listApplicationDocuments(userId: string, id: string) {
    const { application } = await this.requireOwnApplication(userId, id);
    const [documents, missing] = await Promise.all([
      this.applicationDocuments(application.id),
      this.missingRequiredDocuments(application.id),
    ]);
    return {
      applicationId: application.id,
      items: documents.map((doc) => this.mapCustomerDocument(doc)),
      requiredDocuments: this.requiredDocumentChecklist(documents),
      missingDocuments: missing,
      storage: {
        configured: this.storage.isConfigured(),
        pending: !this.storage.isConfigured(),
      },
    };
  }

  async createApplicationDocument(
    userId: string,
    id: string,
    dto: CustomerCreditDocumentUploadDto,
  ) {
    const { ctx, application } = await this.requireOwnApplication(userId, id);
    this.assertCanAttachDocuments(application.status);

    const category = creditDocumentCategory(dto.documentType);
    const created = await this.documents.create({
      organizationId: ctx.organizationId,
      uploadedById: userId,
      ownerType: EntityOwnerType.CREDIT,
      ownerId: application.id,
      customerProfileId: ctx.customerProfileId,
      category,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      fileSizeBytes: dto.fileSizeBytes,
      fileType: dto.fileType,
      status: DocumentStatus.UPLOADED,
      metadata: {
        ...(dto.metadata ?? {}),
        documentType: dto.documentType,
        creditApplicationId: application.id,
      },
    });

    await this.timeline.record({
      creditApplicationId: application.id,
      eventType: CREDIT_APPLICATION_EVENT.DOCUMENT_UPLOADED,
      description: `${CREDIT_DOCUMENT_TYPE_LABELS[dto.documentType]} uploaded`,
      actorUserId: userId,
      actorRole: 'CUSTOMER',
      customerVisible: true,
      metadata: { documentId: created.id, documentType: dto.documentType },
    });
    await this.audit.log({
      action: CREDIT_APPLICATION_EVENT.DOCUMENT_UPLOADED,
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: application.id,
      newData: { documentId: created.id, documentType: dto.documentType },
    });

    return {
      ...created,
      documentType: dto.documentType,
      storageConfigured: this.storage.isConfigured(),
    };
  }

  async replaceApplicationDocument(
    userId: string,
    id: string,
    documentId: string,
    dto: CustomerCreditDocumentReplaceDto,
  ) {
    const { ctx, application } = await this.requireOwnApplication(userId, id);
    this.assertCanAttachDocuments(application.status);

    const existing = await this.documents.requireDocument(
      documentId,
      this.documentOwnership(application.id, ctx.organizationId),
    );
    const documentType = this.documentTypeOf(existing);

    const replaced = await this.documents.replace(
      documentId,
      {
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        fileSizeBytes: dto.fileSizeBytes,
        metadata: {
          ...(dto.metadata ?? {}),
          documentType,
          creditApplicationId: application.id,
        },
      },
      this.documentOwnership(application.id, ctx.organizationId),
    );

    await this.timeline.record({
      creditApplicationId: application.id,
      eventType: CREDIT_APPLICATION_EVENT.DOCUMENT_UPLOADED,
      description: `${this.documentLabel(documentType)} replaced`,
      actorUserId: userId,
      actorRole: 'CUSTOMER',
      customerVisible: true,
      metadata: { documentId, documentType, version: replaced.version },
    });
    await this.audit.log({
      action: 'CREDIT_DOCUMENT_REPLACED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: application.id,
      newData: { documentId, version: replaced.version },
    });

    return { ...replaced, documentType };
  }

  async downloadApplicationDocument(
    userId: string,
    id: string,
    documentId: string,
  ) {
    const { ctx, application } = await this.requireOwnApplication(userId, id);
    const ownership = this.documentOwnership(
      application.id,
      ctx.organizationId,
    );
    if (!this.storage.isConfigured()) {
      const doc = await this.documents.requireDocument(documentId, ownership);
      return {
        id: doc.id,
        fileName: doc.fileName,
        url: null,
        storageConfigured: false,
        storagePending: true,
      };
    }
    const payload = await this.documents.download(documentId, ownership);
    return { ...payload, storageConfigured: true, storagePending: false };
  }

  async applicationDocumentUploadUrl(
    userId: string,
    id: string,
    documentId: string,
  ) {
    const { ctx, application } = await this.requireOwnApplication(userId, id);
    this.assertCanAttachDocuments(application.status);
    return this.documents.getUploadUrl(
      documentId,
      this.documentOwnership(application.id, ctx.organizationId),
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private documentOwnership(applicationId: string, organizationId: string) {
    return {
      ownerType: EntityOwnerType.CREDIT,
      ownerId: applicationId,
      organizationId,
    };
  }

  private assertCanAttachDocuments(status: CreditApplicationStatus) {
    if (!CREDIT_DOCUMENT_UPLOAD_STATUSES.includes(status)) {
      throw new BadRequestException(
        `Documents cannot be changed while the application is ${status}`,
      );
    }
  }

  private async requireOwnApplication(userId: string, id: string) {
    const ctx = await this.context.requireCustomer(userId);
    const application = await this.prisma.creditApplication.findUnique({
      where: { id },
    });
    if (!application) {
      throw new NotFoundException('Credit application not found');
    }
    if (application.customerProfileId !== ctx.customerProfileId) {
      throw new ForbiddenException('UNAUTHORIZED_CUSTOMER_RESOURCE');
    }
    return { ctx, application };
  }

  private findOpenApplication(
    client: Prisma.TransactionClient,
    customerProfileId: string,
  ) {
    return client.creditApplication.findFirst({
      where: { customerProfileId, status: { in: OPEN } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private nextApplicationNumber() {
    return generateUniqueCreditApplicationNumber(async (candidate) =>
      Boolean(
        await this.prisma.creditApplication.findUnique({
          where: { applicationNumber: candidate },
          select: { id: true },
        }),
      ),
    );
  }

  private async markCustomerPending(
    tx: Prisma.TransactionClient,
    customerProfileId: string,
    requestedLimit: Prisma.Decimal,
  ) {
    await tx.customerProfile.update({
      where: { id: customerProfileId },
      data: { creditStatus: CreditStatus.PENDING },
    });
    await tx.customerCreditProfile.upsert({
      where: { customerProfileId },
      update: { status: CreditStatus.PENDING, requestedLimit },
      create: {
        customerProfileId,
        status: CreditStatus.PENDING,
        requestedLimit,
      },
    });
  }

  private applicationDocuments(applicationId: string) {
    return this.prisma.document.findMany({
      where: {
        deletedAt: null,
        ownerType: EntityOwnerType.CREDIT,
        ownerId: applicationId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private documentTypeOf(doc: Pick<Document, 'metadata'>): string {
    const metadata =
      doc.metadata &&
      typeof doc.metadata === 'object' &&
      !Array.isArray(doc.metadata)
        ? (doc.metadata as Record<string, unknown>)
        : {};
    const value = metadata.documentType;
    return typeof value === 'string' ? value : 'other';
  }

  private documentLabel(documentType: string) {
    return (
      CREDIT_DOCUMENT_TYPE_LABELS[
        documentType as CreditApplicationDocumentType
      ] ?? 'Supporting Document'
    );
  }

  /**
   * A requirement is satisfied by an explicit metadata.documentType match, or
   * by a document filed under the category that type maps to.
   */
  private async missingRequiredDocuments(applicationId: string) {
    const documents = await this.applicationDocuments(applicationId);
    return this.requiredDocumentChecklist(documents)
      .filter((item) => !item.uploaded)
      .map((item) => ({ documentType: item.documentType, label: item.label }));
  }

  private requiredDocumentChecklist(
    documents: Pick<Document, 'id' | 'category' | 'status' | 'metadata'>[],
  ) {
    return REQUIRED_CREDIT_DOCUMENT_TYPES.map((documentType) => {
      const category = creditDocumentCategory(documentType);
      const match = documents.find(
        (doc) =>
          this.documentTypeOf(doc) === documentType ||
          doc.category === category,
      );
      return {
        documentType,
        label: CREDIT_DOCUMENT_TYPE_LABELS[documentType],
        category,
        required: true,
        uploaded: Boolean(match),
        documentId: match?.id ?? null,
        status: match?.status ?? null,
      };
    });
  }

  private mapCustomerDocument(doc: Document) {
    return {
      id: doc.id,
      documentNumber: doc.documentNumber,
      documentType: this.documentTypeOf(doc),
      label: this.documentLabel(this.documentTypeOf(doc)),
      category: doc.category,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes?.toString() ?? null,
      status: doc.status,
      version: doc.version,
      rejectionReason: doc.rejectionReason,
      storagePending: doc.storageProvider === 'NONE',
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  /** Customer-safe application projection: no internal notes or risk data. */
  private async buildApplicationView(
    application: CreditApplication,
    customerProfileId: string,
    opts?: { includeTimeline?: boolean },
  ) {
    const [documents, events, account] = await Promise.all([
      this.applicationDocuments(application.id),
      opts?.includeTimeline
        ? this.timeline.list(application.id, { customerVisibleOnly: true })
        : Promise.resolve([]),
      this.prisma.customerCreditProfile.findUnique({
        where: { customerProfileId },
      }),
    ]);

    const checklist = this.requiredDocumentChecklist(documents);
    const missing = checklist
      .filter((item) => !item.uploaded)
      .map((item) => ({ documentType: item.documentType, label: item.label }));

    const resubmissionRequested = isResubmissionRequested(application);
    return {
      id: application.id,
      applicationNumber: application.applicationNumber,
      status: application.status,
      displayStatus: creditDisplayStatus(application),
      resubmissionRequested,
      source: application.source,
      requestedLimit: toDecimal(application.requestedLimit).toFixed(2),
      requestedTenureDays: application.requestedTenureDays,
      purpose: application.purpose,
      currency: application.currency,
      approvedLimit:
        application.approvedLimit != null
          ? toDecimal(application.approvedLimit).toFixed(2)
          : null,
      approvedTenureDays: application.approvedTenureDays,
      insuranceStatus: application.insuranceStatus,
      arrangementStatus: application.arrangementStatus,
      customerMessage: application.customerMessage,
      submittedAt: application.submittedAt,
      decidedAt: application.decidedAt,
      effectiveAt: application.effectiveAt,
      expiresAt: application.expiresAt,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
      nextStep: creditNextStep(application.status, { resubmissionRequested }),
      canSubmit:
        application.status === CreditApplicationStatus.DRAFT &&
        missing.length === 0,
      requiredDocuments: checklist,
      missingDocuments: missing,
      documents: documents.map((doc) => this.mapCustomerDocument(doc)),
      ...(opts?.includeTimeline ? { timeline: events } : {}),
      account: account ? this.mapAccount(account) : null,
      storage: {
        configured: this.storage.isConfigured(),
        pending: !this.storage.isConfigured(),
      },
    };
  }

  private async notifyAdmins(
    applicationId: string,
    title: string,
    body: string,
  ) {
    const adminRoles = await this.prisma.userRole.findMany({
      where: { role: { code: { in: ADMIN_NOTIFY_ROLES } } },
      select: { userId: true },
      distinct: ['userId'],
    });
    await Promise.all(
      adminRoles.map((row) =>
        this.notifications.create({
          userId: row.userId,
          title,
          body,
          entityType: EntityOwnerType.CREDIT,
          entityId: applicationId,
        }),
      ),
    );
  }

  private mapAccount(account: {
    id: string;
    accountNumber: string | null;
    status: CreditStatus;
    accountStatus: string;
    approvedLimit: Prisma.Decimal | number | string | null;
    availableLimit: Prisma.Decimal | number | string | null;
    pendingCredit?: Prisma.Decimal | number | string | null;
    utilizedAmount: Prisma.Decimal | number | string | null;
    outstandingAmount: Prisma.Decimal | number | string | null;
    overdueAmount: Prisma.Decimal | number | string | null;
    currency: string;
    creditTermDays: number | null;
    approvedAt: Date | null;
    expiresAt: Date | null;
  }) {
    return {
      id: account.id,
      accountNumber: account.accountNumber,
      status: account.status,
      accountStatus: account.accountStatus,
      approvedLimit: toDecimal(account.approvedLimit).toFixed(2),
      availableLimit: toDecimal(account.availableLimit).toFixed(2),
      pendingCredit: toDecimal(account.pendingCredit).toFixed(2),
      utilizedAmount: toDecimal(account.utilizedAmount).toFixed(2),
      outstandingAmount: toDecimal(account.outstandingAmount).toFixed(2),
      overdueAmount: toDecimal(account.overdueAmount).toFixed(2),
      utilizationPercentage: utilizationPercentage(
        account.utilizedAmount,
        account.approvedLimit,
      ),
      currency: account.currency,
      creditTermDays: account.creditTermDays,
      approvedAt: account.approvedAt,
      expiresAt: account.expiresAt,
    };
  }

  private displayStatus(snapshot: {
    application?: { status: string } | null;
    account?: {
      status: string;
      accountStatus: string;
    } | null;
  }) {
    if (!snapshot.account && !snapshot.application) return 'NOT_APPLIED';
    if (snapshot.account?.accountStatus === 'SUSPENDED') return 'SUSPENDED';
    if (snapshot.account?.accountStatus === 'BLOCKED') return 'BLOCKED';
    if (snapshot.account?.accountStatus === 'EXPIRED') return 'EXPIRED';
    if (snapshot.account?.status === CreditStatus.APPROVED) return 'ACTIVE';
    return (
      snapshot.application?.status ?? snapshot.account?.status ?? 'PENDING'
    );
  }
}
