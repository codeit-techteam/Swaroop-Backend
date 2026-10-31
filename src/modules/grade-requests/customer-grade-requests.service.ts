import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentCategory,
  DocumentStatus,
  EntityOwnerType,
  GradeStatus,
  NewGradeRequestStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { CustomerContextService } from '../customers/common/customer-context.service.js';
import { DocumentsCoreService } from '../documents/services/documents-core.service.js';
import { generateUniqueCreditRef } from '../payments/common/credit-number.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../master-data/common/pagination.js';
import type {
  CreateGradeRequestDto,
  CustomerGradeRequestQueryDto,
  GradeRequestCancelDto,
  GradeRequestDocumentDto,
  GradeRequestRespondDto,
} from './grade-requests.dto.js';
import {
  GRADE_REQUEST_STATUS_DESCRIPTIONS,
  GRADE_REQUEST_STATUS_LABELS,
  MAX_GRADE_REQUEST_DOCUMENTS,
  OPEN_GRADE_REQUEST_STATUSES,
  canTransition,
  collapseSpaces,
  emptyToNull,
  normalizeDedupeKey,
  normalizeIndianMobile,
  toCustomerTimeline,
} from './grade-requests.shared.js';
import { GradeRequestSupport } from './grade-requests.support.js';

const requestInclude = {
  resolvedGrade: {
    select: {
      id: true,
      code: true,
      name: true,
      displayName: true,
      status: true,
      customerVisible: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.NewGradeRequestInclude;

type RequestRow = Prisma.NewGradeRequestGetPayload<{
  include: typeof requestInclude;
}>;

@Injectable()
export class CustomerGradeRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: CustomerContextService,
    private readonly documents: DocumentsCoreService,
    private readonly storage: StorageService,
    private readonly support: GradeRequestSupport,
  ) {}

  /** Prefill data so the form never asks for what the backend already knows. */
  async prefill(userId: string) {
    const ctx = await this.context.requireCustomer(userId);
    const [user, address] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          firstName: true,
          lastName: true,
          displayName: true,
          email: true,
          phone: true,
          phoneVerified: true,
          emailVerified: true,
        },
      }),
      this.prisma.address.findFirst({
        where: {
          organizationId: ctx.organizationId,
          deletedAt: null,
          isActive: true,
        },
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      }),
    ]);
    const contactName =
      user?.displayName ||
      [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
      null;
    return {
      companyName: ctx.organizationName,
      contactName,
      contactPhone: user?.phone ?? null,
      contactPhoneVerified: Boolean(user?.phoneVerified),
      contactEmail: user?.email ?? null,
      contactEmailVerified: Boolean(user?.emailVerified),
      defaultAddress: address
        ? {
            id: address.id,
            label: address.label,
            line1: address.line1,
            city: address.city,
            state: address.state,
            postalCode: address.postalCode,
            formatted:
              address.formattedAddress ||
              [address.line1, address.city, address.state, address.postalCode]
                .filter(Boolean)
                .join(', '),
          }
        : null,
      limits: {
        maxDocuments: MAX_GRADE_REQUEST_DOCUMENTS,
        maxFileSizeBytes: this.storage.getMaxDocumentSizeBytes(),
        allowedMimeTypes: [
          'application/pdf',
          'image/jpeg',
          'image/png',
          'image/webp',
        ],
        storageConfigured: this.storage.isConfigured(),
      },
    };
  }

  async create(userId: string, dto: CreateGradeRequestDto) {
    const ctx = await this.context.requireCustomer(userId);

    // Idempotent retry: same key from the same customer returns the original.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.newGradeRequest.findUnique({
        where: {
          idempotencyKey: `${ctx.customerProfileId}:${dto.idempotencyKey}`,
        },
        include: requestInclude,
      });
      if (existing && existing.customerProfileId === ctx.customerProfileId) {
        return this.toCustomerView(existing, [], []);
      }
    }

    const phone = normalizeIndianMobile(dto.contactPhone);
    if (!phone) {
      throw new BadRequestException({
        code: 'INVALID_CONTACT_PHONE',
        message: 'Enter a valid 10-digit mobile number.',
      });
    }

    if (dto.requiredByDate) {
      const required = new Date(
        `${dto.requiredByDate.slice(0, 10)}T00:00:00.000Z`,
      );
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (Number.isNaN(required.getTime()) || required < today) {
        throw new BadRequestException({
          code: 'INVALID_REQUIRED_BY_DATE',
          message: 'Required-by date cannot be in the past.',
        });
      }
    }

    if (dto.categoryId) {
      const category = await this.prisma.gradeCategory.findFirst({
        where: { id: dto.categoryId, deletedAt: null },
        select: { id: true },
      });
      if (!category) throw new NotFoundException('Category not found');
    }

    // Ownership: the address must belong to this customer's organisation.
    if (dto.deliveryAddressId) {
      const address = await this.prisma.address.findFirst({
        where: {
          id: dto.deliveryAddressId,
          organizationId: ctx.organizationId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!address) {
        throw new ForbiddenException('UNAUTHORIZED_CUSTOMER_RESOURCE');
      }
    }

    const gradeName = collapseSpaces(dto.gradeName);
    const manufacturer = emptyToNull(dto.manufacturer);
    const dedupeKey = normalizeDedupeKey(gradeName, manufacturer);

    // Rule 1: one OPEN request per (grade name + manufacturer) per customer.
    const open = await this.prisma.newGradeRequest.findFirst({
      where: {
        customerProfileId: ctx.customerProfileId,
        dedupeKey,
        status: { in: OPEN_GRADE_REQUEST_STATUSES },
      },
      select: { id: true, referenceNumber: true, status: true },
    });
    if (open) {
      throw new ConflictException({
        code: 'DUPLICATE_OPEN_REQUEST',
        message: `You already have an open request (${open.referenceNumber}) for this grade.`,
        details: {
          existing: {
            id: open.id,
            referenceNumber: open.referenceNumber,
            status: open.status,
          },
        },
      });
    }

    // Rule 2: don't create a "new" grade that already exists in the catalogue.
    if (!dto.acknowledgeExisting) {
      const matches = await this.findCatalogueMatches(gradeName, manufacturer);
      if (matches.length) {
        throw new ConflictException({
          code: 'GRADE_ALREADY_IN_CATALOGUE',
          message:
            'This grade appears to exist in the catalogue already. Select it, or confirm that you want to request it anyway.',
          details: { matches },
        });
      }
    }

    const referenceNumber = await generateUniqueCreditRef(
      async (candidate) =>
        Boolean(
          await this.prisma.newGradeRequest.findUnique({
            where: { referenceNumber: candidate },
            select: { id: true },
          }),
        ),
      'NGR',
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.newGradeRequest.create({
        data: {
          referenceNumber,
          customerProfileId: ctx.customerProfileId,
          requestedById: userId,
          status: NewGradeRequestStatus.SUBMITTED,
          gradeName,
          materialCategory: collapseSpaces(dto.materialCategory),
          categoryId: dto.categoryId ?? null,
          manufacturer,
          gradeGroup: emptyToNull(dto.gradeGroup),
          application: emptyToNull(dto.application),
          technicalSpecs: dto.technicalSpecs?.trim() || null,
          remarks: dto.remarks?.trim() || null,
          quantity: new Prisma.Decimal(dto.quantity),
          unit: dto.unit,
          deliveryLocation: collapseSpaces(dto.deliveryLocation),
          deliveryPincode: dto.deliveryPincode ?? null,
          deliveryAddressId: dto.deliveryAddressId ?? null,
          requiredByDate: dto.requiredByDate
            ? new Date(`${dto.requiredByDate.slice(0, 10)}T00:00:00.000Z`)
            : null,
          preferredPackaging: emptyToNull(dto.preferredPackaging),
          contactName: collapseSpaces(dto.contactName),
          contactPhone: phone,
          contactEmail: dto.contactEmail?.toLowerCase() ?? null,
          dedupeKey,
          idempotencyKey: dto.idempotencyKey
            ? `${ctx.customerProfileId}:${dto.idempotencyKey}`
            : null,
        },
        include: requestInclude,
      });
      await this.support.recordEvent(tx, {
        requestId: row.id,
        eventType: 'SUBMITTED',
        actorRole: 'CUSTOMER',
        actorUserId: userId,
        toStatus: NewGradeRequestStatus.SUBMITTED,
        message: 'Request submitted',
      });
      return row;
    });

    await this.support.audit({
      action: 'NEW_GRADE_REQUEST_SUBMITTED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      requestId: created.id,
      newData: {
        referenceNumber,
        gradeName,
        manufacturer,
        quantity: dto.quantity,
        unit: dto.unit,
      },
    });
    await this.support.notifyAdmins(
      created,
      'New grade request',
      `${ctx.organizationName} requested "${gradeName}"${
        manufacturer ? ` (${manufacturer})` : ''
      } — ${referenceNumber}`,
    );

    return this.toCustomerView(created, [], []);
  }

  async list(userId: string, query: CustomerGradeRequestQueryDto) {
    const ctx = await this.context.requireCustomer(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const search = resolveSearch(query);
    const where: Prisma.NewGradeRequestWhereInput = {
      customerProfileId: ctx.customerProfileId,
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { referenceNumber: { contains: search, mode: 'insensitive' } },
              { gradeName: { contains: search, mode: 'insensitive' } },
              { manufacturer: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.newGradeRequest.count({ where }),
      this.prisma.newGradeRequest.findMany({
        where,
        include: requestInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ]);
    return {
      items: rows.map((r) => this.toCustomerView(r, [], [])),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getOne(userId: string, id: string) {
    const { row } = await this.requireOwn(userId, id);
    const [events, docs] = await Promise.all([
      this.prisma.newGradeRequestEvent.findMany({
        where: { requestId: row.id, internal: false },
        orderBy: { createdAt: 'asc' },
      }),
      this.listDocuments(row.id),
    ]);
    return this.toCustomerView(row, events, docs);
  }

  /** Customer answers an "Additional Information Required" request. */
  async respond(userId: string, id: string, dto: GradeRequestRespondDto) {
    const { ctx, row } = await this.requireOwn(userId, id);
    if (row.status !== NewGradeRequestStatus.INFO_REQUIRED) {
      throw new BadRequestException({
        code: 'RESPONSE_NOT_REQUESTED',
        message: 'This request is not waiting for additional information.',
      });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.newGradeRequest.updateMany({
        where: { id: row.id, status: NewGradeRequestStatus.INFO_REQUIRED },
        data: {
          status: NewGradeRequestStatus.UNDER_REVIEW,
          customerResponse: dto.message,
          adminMessage: null,
        },
      });
      if (res.count === 0) {
        throw new ConflictException('Request was updated by someone else');
      }
      await this.support.recordEvent(tx, {
        requestId: row.id,
        eventType: 'CUSTOMER_RESPONDED',
        actorRole: 'CUSTOMER',
        actorUserId: userId,
        fromStatus: NewGradeRequestStatus.INFO_REQUIRED,
        toStatus: NewGradeRequestStatus.UNDER_REVIEW,
        message: dto.message,
      });
      return tx.newGradeRequest.findUniqueOrThrow({
        where: { id: row.id },
        include: requestInclude,
      });
    });
    await this.support.audit({
      action: 'NEW_GRADE_REQUEST_CUSTOMER_RESPONDED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      requestId: row.id,
    });
    await this.support.notifyAdmins(
      updated,
      'Customer responded to grade request',
      `${ctx.organizationName} answered the information request on ${row.referenceNumber}`,
    );
    return this.toCustomerView(updated, [], []);
  }

  async cancel(userId: string, id: string, dto: GradeRequestCancelDto) {
    const { ctx, row } = await this.requireOwn(userId, id);
    if (!canTransition(row.status, NewGradeRequestStatus.CLOSED)) {
      throw new BadRequestException({
        code: 'REQUEST_NOT_CANCELLABLE',
        message: `A request that is ${GRADE_REQUEST_STATUS_LABELS[row.status]} cannot be cancelled.`,
      });
    }
    const reason = dto.reason?.trim() || 'Cancelled by customer';
    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.newGradeRequest.updateMany({
        where: { id: row.id, status: row.status },
        data: {
          status: NewGradeRequestStatus.CLOSED,
          closureReason: reason,
          closedAt: new Date(),
        },
      });
      if (res.count === 0) {
        throw new ConflictException('Request was updated by someone else');
      }
      await this.support.recordEvent(tx, {
        requestId: row.id,
        eventType: 'CANCELLED_BY_CUSTOMER',
        actorRole: 'CUSTOMER',
        actorUserId: userId,
        fromStatus: row.status,
        toStatus: NewGradeRequestStatus.CLOSED,
        message: reason,
      });
      return tx.newGradeRequest.findUniqueOrThrow({
        where: { id: row.id },
        include: requestInclude,
      });
    });
    await this.support.audit({
      action: 'NEW_GRADE_REQUEST_CANCELLED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      requestId: row.id,
      previousData: { status: row.status },
      newData: { status: NewGradeRequestStatus.CLOSED, reason },
    });
    await this.support.notifyAdmins(
      updated,
      'Grade request cancelled by customer',
      `${ctx.organizationName} cancelled ${row.referenceNumber}`,
    );
    return this.toCustomerView(updated, [], []);
  }

  // ---- Documents -------------------------------------------------------------

  async createDocument(
    userId: string,
    id: string,
    dto: GradeRequestDocumentDto,
  ) {
    const { ctx, row } = await this.requireOwn(userId, id);
    this.assertCanAttach(row.status);

    const existingCount = await this.prisma.document.count({
      where: {
        ownerType: EntityOwnerType.NEW_GRADE_REQUEST,
        ownerId: row.id,
        deletedAt: null,
      },
    });
    if (existingCount >= MAX_GRADE_REQUEST_DOCUMENTS) {
      throw new BadRequestException({
        code: 'DOCUMENT_LIMIT_REACHED',
        message: `You can attach up to ${MAX_GRADE_REQUEST_DOCUMENTS} documents.`,
      });
    }

    const created = await this.documents.create({
      organizationId: ctx.organizationId,
      uploadedById: userId,
      ownerType: EntityOwnerType.NEW_GRADE_REQUEST,
      ownerId: row.id,
      customerProfileId: ctx.customerProfileId,
      category: DocumentCategory[dto.documentType],
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      fileSizeBytes: dto.fileSizeBytes,
      status: DocumentStatus.UPLOADED,
      metadata: {
        purpose: 'NEW_GRADE_REQUEST',
        gradeRequestId: row.id,
        referenceNumber: row.referenceNumber,
        documentType: dto.documentType,
      },
    });

    await this.support.recordEvent(this.prisma, {
      requestId: row.id,
      eventType: 'DOCUMENT_ATTACHED',
      actorRole: 'CUSTOMER',
      actorUserId: userId,
      message: `Attached ${dto.fileName}`,
      metadata: { documentId: created.id, documentType: dto.documentType },
    });
    await this.support.audit({
      action: 'NEW_GRADE_REQUEST_DOCUMENT_ATTACHED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      requestId: row.id,
      newData: { documentId: created.id, documentType: dto.documentType },
    });

    return {
      ...created,
      documentType: dto.documentType,
      storageConfigured: this.storage.isConfigured(),
    };
  }

  async documentUploadUrl(userId: string, id: string, documentId: string) {
    const { ctx, row } = await this.requireOwn(userId, id);
    this.assertCanAttach(row.status);
    return this.documents.getUploadUrl(
      documentId,
      this.ownership(row.id, ctx.organizationId),
    );
  }

  async downloadDocument(userId: string, id: string, documentId: string) {
    const { ctx, row } = await this.requireOwn(userId, id);
    const ownership = this.ownership(row.id, ctx.organizationId);
    if (!this.storage.isConfigured()) {
      const doc = await this.documents.requireDocument(documentId, ownership);
      return {
        id: doc.id,
        fileName: doc.fileName,
        url: null,
        storageConfigured: false,
      };
    }
    const payload = await this.documents.download(documentId, ownership);
    return { ...payload, storageConfigured: true };
  }

  // ---- Internals -------------------------------------------------------------

  private ownership(requestId: string, organizationId: string) {
    return {
      ownerType: EntityOwnerType.NEW_GRADE_REQUEST,
      ownerId: requestId,
      organizationId,
    };
  }

  private assertCanAttach(status: NewGradeRequestStatus) {
    if (!OPEN_GRADE_REQUEST_STATUSES.includes(status)) {
      throw new BadRequestException({
        code: 'REQUEST_CLOSED',
        message: 'Documents cannot be added to a closed request.',
      });
    }
  }

  private async listDocuments(requestId: string) {
    const docs = await this.prisma.document.findMany({
      where: {
        ownerType: EntityOwnerType.NEW_GRADE_REQUEST,
        ownerId: requestId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        fileSizeBytes: true,
        category: true,
        createdAt: true,
      },
    });
    return docs.map((d) => ({
      id: d.id,
      fileName: d.fileName,
      mimeType: d.mimeType,
      fileSizeBytes: d.fileSizeBytes?.toString() ?? null,
      documentType: d.category,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  private async requireOwn(userId: string, id: string) {
    const ctx = await this.context.requireCustomer(userId);
    const row = await this.prisma.newGradeRequest.findUnique({
      where: { id },
      include: requestInclude,
    });
    if (!row) throw new NotFoundException('Grade request not found');
    if (row.customerProfileId !== ctx.customerProfileId) {
      // Don't reveal that another customer's request exists.
      throw new NotFoundException('Grade request not found');
    }
    return { ctx, row };
  }

  /** Only catalogue grades customers can actually see are used as suggestions. */
  private async findCatalogueMatches(
    gradeName: string,
    manufacturer: string | null,
  ) {
    const eq = { equals: gradeName, mode: 'insensitive' as const };
    const grades = await this.prisma.grade.findMany({
      where: {
        deletedAt: null,
        status: GradeStatus.ACTIVE,
        customerVisible: true,
        AND: [
          {
            OR: [
              { gradeNo: eq },
              { code: eq },
              { name: eq },
              { fullGradeName: eq },
            ],
          },
          ...(manufacturer
            ? [
                {
                  OR: [
                    {
                      manufacturer: {
                        equals: manufacturer,
                        mode: 'insensitive' as const,
                      },
                    },
                    { manufacturer: null },
                  ],
                },
              ]
            : []),
        ],
      },
      take: 5,
      select: {
        id: true,
        code: true,
        name: true,
        displayName: true,
        gradeNo: true,
        manufacturer: true,
      },
    });
    return grades.map((g) => ({
      id: g.id,
      code: g.code,
      name: g.displayName || g.name,
      gradeNo: g.gradeNo,
      manufacturer: g.manufacturer,
    }));
  }

  private toCustomerView(
    row: RequestRow,
    events: Parameters<typeof toCustomerTimeline>[0],
    documents: Array<Record<string, unknown>>,
  ) {
    // The resolved grade is only revealed once it is live in the catalogue —
    // an unpublished grade created by an admin must never leak.
    const grade = row.resolvedGrade;
    const gradePublished =
      grade &&
      !grade.deletedAt &&
      grade.status === GradeStatus.ACTIVE &&
      grade.customerVisible;

    return {
      id: row.id,
      referenceNumber: row.referenceNumber,
      status: row.status,
      statusLabel: GRADE_REQUEST_STATUS_LABELS[row.status],
      statusDescription: GRADE_REQUEST_STATUS_DESCRIPTIONS[row.status],
      isOpen: OPEN_GRADE_REQUEST_STATUSES.includes(row.status),
      awaitingCustomerResponse:
        row.status === NewGradeRequestStatus.INFO_REQUIRED,
      gradeName: row.gradeName,
      materialCategory: row.materialCategory,
      manufacturer: row.manufacturer,
      gradeGroup: row.gradeGroup,
      application: row.application,
      technicalSpecs: row.technicalSpecs,
      remarks: row.remarks,
      quantity: row.quantity.toString(),
      unit: row.unit,
      deliveryLocation: row.deliveryLocation,
      deliveryPincode: row.deliveryPincode,
      requiredByDate: row.requiredByDate
        ? row.requiredByDate.toISOString().slice(0, 10)
        : null,
      preferredPackaging: row.preferredPackaging,
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      contactEmail: row.contactEmail,
      adminMessage: row.adminMessage,
      closureReason: row.closureReason,
      resolvedGrade: gradePublished
        ? {
            id: grade.id,
            code: grade.code,
            name: grade.displayName || grade.name,
          }
        : null,
      submittedAt: row.submittedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      timeline: toCustomerTimeline(events),
      documents,
    };
  }
}
