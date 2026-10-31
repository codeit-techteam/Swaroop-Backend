import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EntityOwnerType,
  GradeStatus,
  NewGradeRequestStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import { RoleCode } from '../../common/enums/domain.enums.js';
import { PrismaService } from '../../database/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { DocumentsCoreService } from '../documents/services/documents-core.service.js';
import { GradesService } from '../master-data/grades/grades.service.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../master-data/common/pagination.js';
import type {
  AdminAssignDto,
  AdminCreateGradeFromRequestDto,
  AdminGradeRequestQueryDto,
  AdminMapGradeDto,
  AdminNoteDto,
  AdminRequestInfoDto,
  AdminStatusDto,
} from './grade-requests.dto.js';
import {
  ADMIN_DIRECT_STATUSES,
  GRADE_REQUEST_STATUS_LABELS,
  OPEN_GRADE_REQUEST_STATUSES,
  STATUSES_REQUIRING_REASON,
  TERMINAL_GRADE_REQUEST_STATUSES,
  canTransition,
} from './grade-requests.shared.js';
import {
  GRADE_REQUEST_ADMIN_ROLES,
  GradeRequestSupport,
} from './grade-requests.support.js';

const adminInclude = {
  customerProfile: {
    select: {
      id: true,
      organizationId: true,
      organization: { select: { id: true, name: true } },
      user: {
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          displayName: true,
        },
      },
    },
  },
  category: { select: { id: true, code: true, name: true, displayName: true } },
  assignedAdmin: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      displayName: true,
    },
  },
  resolvedGrade: {
    select: {
      id: true,
      code: true,
      name: true,
      displayName: true,
      status: true,
      customerVisible: true,
      sellerVisible: true,
    },
  },
} satisfies Prisma.NewGradeRequestInclude;

type AdminRow = Prisma.NewGradeRequestGetPayload<{
  include: typeof adminInclude;
}>;

type Actor = { id: string; roles: string[] };

const nameOf = (
  u?: {
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  } | null,
) =>
  u
    ? u.displayName ||
      [u.firstName, u.lastName].filter(Boolean).join(' ') ||
      u.email ||
      null
    : null;

@Injectable()
export class AdminGradeRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: GradeRequestSupport,
    private readonly grades: GradesService,
    private readonly documents: DocumentsCoreService,
    private readonly storage: StorageService,
  ) {}

  // ---- Reads -----------------------------------------------------------------

  async list(query: AdminGradeRequestQueryDto, actor: Actor) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const search = resolveSearch(query);
    const where: Prisma.NewGradeRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.manufacturer
        ? {
            manufacturer: {
              equals: query.manufacturer.trim(),
              mode: 'insensitive',
            },
          }
        : {}),
      ...(query.assignee === 'unassigned'
        ? { assignedAdminId: null }
        : query.assignee === 'me'
          ? { assignedAdminId: actor.id }
          : query.assignee
            ? { assignedAdminId: query.assignee }
            : {}),
      ...(search
        ? {
            OR: [
              { referenceNumber: { contains: search, mode: 'insensitive' } },
              { gradeName: { contains: search, mode: 'insensitive' } },
              { manufacturer: { contains: search, mode: 'insensitive' } },
              { materialCategory: { contains: search, mode: 'insensitive' } },
              { gradeGroup: { contains: search, mode: 'insensitive' } },
              { contactName: { contains: search, mode: 'insensitive' } },
              {
                customerProfile: {
                  organization: {
                    name: { contains: search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.newGradeRequest.count({ where }),
      this.prisma.newGradeRequest.findMany({
        where,
        include: adminInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ]);
    return {
      items: rows.map((r) => this.toAdminView(r)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async summary() {
    const grouped = await this.prisma.newGradeRequest.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const byStatus = Object.fromEntries(
      Object.values(NewGradeRequestStatus).map((s) => [s, 0]),
    ) as Record<NewGradeRequestStatus, number>;
    for (const g of grouped) byStatus[g.status] = g._count._all;
    const unassigned = await this.prisma.newGradeRequest.count({
      where: {
        assignedAdminId: null,
        status: { in: OPEN_GRADE_REQUEST_STATUSES },
      },
    });
    return {
      byStatus,
      open: OPEN_GRADE_REQUEST_STATUSES.reduce((n, s) => n + byStatus[s], 0),
      unassigned,
    };
  }

  async getById(id: string) {
    const row = await this.require(id);
    const [events, documents] = await Promise.all([
      this.prisma.newGradeRequestEvent.findMany({
        where: { requestId: id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.document.findMany({
        where: {
          ownerType: EntityOwnerType.NEW_GRADE_REQUEST,
          ownerId: id,
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
      }),
    ]);
    const actorIds = [
      ...new Set(events.map((e) => e.actorUserId).filter(Boolean)),
    ] as string[];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        })
      : [];
    const actorName = new Map(actors.map((a) => [a.id, nameOf(a)]));
    return {
      ...this.toAdminView(row),
      timeline: events.map((e) => ({
        id: e.id,
        type: e.eventType,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actorRole: e.actorRole,
        actorUserId: e.actorUserId,
        actorName: e.actorUserId
          ? (actorName.get(e.actorUserId) ?? null)
          : null,
        message: e.message,
        internal: e.internal,
        metadata: e.metadata,
        createdAt: e.createdAt.toISOString(),
      })),
      documents: documents.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        mimeType: d.mimeType,
        fileSizeBytes: d.fileSizeBytes?.toString() ?? null,
        documentType: d.category,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }

  // ---- Workflow --------------------------------------------------------------

  async assign(id: string, dto: AdminAssignDto, actor: Actor) {
    const row = await this.require(id);
    const targetId = dto.adminUserId ?? actor.id;
    const isCore =
      actor.roles.includes(RoleCode.ADMIN) ||
      actor.roles.includes(RoleCode.SUPER_ADMIN);
    if (targetId !== actor.id && !isCore) {
      throw new ForbiddenException(
        'Only an admin can assign a request to someone else',
      );
    }
    const target = await this.prisma.userRole.findFirst({
      where: {
        userId: targetId,
        role: { code: { in: [...GRADE_REQUEST_ADMIN_ROLES] } },
      },
      select: { userId: true },
    });
    if (!target) {
      throw new BadRequestException(
        'Assignee must be an admin or procurement/operations manager',
      );
    }
    this.assertOpen(row);
    await this.prisma.$transaction(async (tx) => {
      await tx.newGradeRequest.update({
        where: { id },
        data: { assignedAdminId: targetId },
      });
      await this.support.recordEvent(tx, {
        requestId: id,
        eventType: 'ASSIGNED',
        actorRole: 'ADMIN',
        actorUserId: actor.id,
        internal: true,
        message: targetId === actor.id ? 'Self-assigned' : 'Assigned',
        metadata: { assignedAdminId: targetId, previous: row.assignedAdminId },
      });
    });
    await this.support.audit({
      action: 'NEW_GRADE_REQUEST_ASSIGNED',
      actorUserId: actor.id,
      requestId: id,
      previousData: { assignedAdminId: row.assignedAdminId },
      newData: { assignedAdminId: targetId },
    });
    return this.getById(id);
  }

  async changeStatus(id: string, dto: AdminStatusDto, actor: Actor) {
    if (!ADMIN_DIRECT_STATUSES.includes(dto.status)) {
      throw new BadRequestException({
        code: 'USE_DEDICATED_ACTION',
        message:
          dto.status === NewGradeRequestStatus.INFO_REQUIRED
            ? 'Use "request additional information" so the customer is told what to provide.'
            : 'Use "map grade" or "create grade" to mark a grade as identified.',
      });
    }
    if (
      STATUSES_REQUIRING_REASON.includes(dto.status) &&
      !dto.message?.trim()
    ) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'A reason is required. It is shown to the customer.',
      });
    }
    const row = await this.require(id);
    if (
      dto.status === NewGradeRequestStatus.CONVERTED_TO_PR &&
      !row.resolvedGradeId
    ) {
      throw new BadRequestException({
        code: 'GRADE_NOT_RESOLVED',
        message:
          'Map or create the catalogue grade before converting to a purchase request.',
      });
    }
    return this.applyTransition(row, dto.status, actor, {
      message: dto.message,
      eventType: 'STATUS_CHANGED',
    });
  }

  async requestInfo(id: string, dto: AdminRequestInfoDto, actor: Actor) {
    const row = await this.require(id);
    return this.applyTransition(
      row,
      NewGradeRequestStatus.INFO_REQUIRED,
      actor,
      {
        message: dto.message,
        eventType: 'INFO_REQUESTED',
      },
    );
  }

  async addNote(id: string, dto: AdminNoteDto, actor: Actor) {
    const row = await this.require(id);
    await this.support.recordEvent(this.prisma, {
      requestId: id,
      eventType: 'INTERNAL_NOTE',
      actorRole: 'ADMIN',
      actorUserId: actor.id,
      internal: true,
      message: dto.note,
    });
    await this.support.audit({
      action: 'NEW_GRADE_REQUEST_NOTE_ADDED',
      actorUserId: actor.id,
      requestId: id,
      metadata: { referenceNumber: row.referenceNumber },
    });
    return this.getById(id);
  }

  /** Link an existing catalogue grade that is equivalent to the request. */
  async mapGrade(id: string, dto: AdminMapGradeDto, actor: Actor) {
    const row = await this.require(id);
    this.assertCanResolve(row);
    const grade = await this.prisma.grade.findFirst({
      where: { id: dto.gradeId, deletedAt: null },
      select: { id: true, code: true, name: true },
    });
    if (!grade) throw new NotFoundException('Grade not found');

    await this.resolve(row, actor, {
      gradeId: grade.id,
      resolutionType: 'MAPPED_EXISTING',
      message:
        dto.message?.trim() ||
        `We matched your request to catalogue grade ${grade.code}.`,
      internalNote: dto.note,
      auditAction: 'NEW_GRADE_REQUEST_GRADE_MAPPED',
    });
    return this.getById(id);
  }

  /**
   * Create a catalogue grade from the request. The grade is created UNPUBLISHED
   * (inactive, hidden from customers and sellers); it only becomes searchable
   * after an admin publishes it through the normal Grade Master workflow.
   */
  async createGrade(
    id: string,
    dto: AdminCreateGradeFromRequestDto,
    actor: Actor,
  ) {
    const row = await this.require(id);
    this.assertCanResolve(row);
    if (row.resolvedGradeId) {
      throw new ConflictException({
        code: 'GRADE_ALREADY_RESOLVED',
        message: 'This request already has a catalogue grade linked.',
      });
    }

    const created = await this.grades.create(
      {
        code: dto.code,
        name: dto.name,
        displayName: dto.displayName,
        categoryId: dto.categoryId,
        description: dto.description ?? row.technicalSpecs ?? undefined,
        applicationCodes: dto.applicationCodes,
        hsnCode: dto.hsnCode,
        status: GradeStatus.INACTIVE,
        customerVisible: false,
        sellerVisible: false,
      },
      actor.id,
    );
    await this.prisma.grade.update({
      where: { id: created.id },
      data: {
        gradeNo: dto.gradeNo ?? null,
        manufacturer: dto.manufacturer ?? row.manufacturer,
        gradeGroup: dto.gradeGroup ?? row.gradeGroup,
        metadata: {
          createdFromGradeRequest: row.referenceNumber,
          ...(dto.metadata ?? {}),
        } as Prisma.InputJsonValue,
      },
    });

    await this.resolve(row, actor, {
      gradeId: created.id,
      resolutionType: 'CREATED_NEW',
      message:
        dto.message?.trim() ||
        'We identified your requirement. The grade will be available in the catalogue after verification.',
      internalNote: `Created catalogue grade ${created.code} (unpublished)`,
      auditAction: 'NEW_GRADE_REQUEST_GRADE_CREATED',
    });

    return {
      request: await this.getById(id),
      grade: created,
      publicationRequired: true,
      note: 'The grade is unpublished. Publish it from Grade Master (status ACTIVE + customer visible) once verified.',
    };
  }

  async downloadDocument(
    id: string,
    documentId: string,
    actor: Actor,
    disposition: 'inline' | 'attachment' = 'attachment',
  ) {
    const row = await this.require(id);
    const ownership = {
      ownerType: EntityOwnerType.NEW_GRADE_REQUEST,
      ownerId: row.id,
    };
    await this.support.audit({
      action: 'NEW_GRADE_REQUEST_DOCUMENT_DOWNLOADED',
      actorUserId: actor.id,
      requestId: id,
      metadata: { documentId, disposition },
    });
    if (!this.storage.isConfigured()) {
      const doc = await this.documents.requireDocument(documentId, ownership);
      return {
        id: doc.id,
        fileName: doc.fileName,
        url: null,
        storageConfigured: false,
      };
    }
    const payload = await this.documents.download(documentId, ownership, {
      disposition,
      expiresInSeconds: 300,
      verifyExists: true,
    });
    return { ...payload, storageConfigured: true };
  }

  // ---- Internals -------------------------------------------------------------

  private assertOpen(row: AdminRow) {
    if (TERMINAL_GRADE_REQUEST_STATUSES.includes(row.status)) {
      throw new BadRequestException({
        code: 'REQUEST_CLOSED',
        message: `This request is ${GRADE_REQUEST_STATUS_LABELS[row.status]}.`,
      });
    }
  }

  private assertCanResolve(row: AdminRow) {
    const ok: NewGradeRequestStatus[] = [
      NewGradeRequestStatus.SUBMITTED,
      NewGradeRequestStatus.UNDER_REVIEW,
      NewGradeRequestStatus.GRADE_IDENTIFIED,
    ];
    if (!ok.includes(row.status)) {
      throw new BadRequestException({
        code: 'INVALID_STATE_FOR_RESOLUTION',
        message: `A grade cannot be linked while the request is ${GRADE_REQUEST_STATUS_LABELS[row.status]}.`,
      });
    }
  }

  private async resolve(
    row: AdminRow,
    actor: Actor,
    input: {
      gradeId: string;
      resolutionType: 'MAPPED_EXISTING' | 'CREATED_NEW';
      message: string;
      internalNote?: string;
      auditAction: string;
    },
  ) {
    const sameStatus = row.status === NewGradeRequestStatus.GRADE_IDENTIFIED;
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.newGradeRequest.updateMany({
        where: { id: row.id, status: row.status },
        data: {
          status: NewGradeRequestStatus.GRADE_IDENTIFIED,
          resolvedGradeId: input.gradeId,
          resolutionType: input.resolutionType,
          adminMessage: input.message,
          assignedAdminId: row.assignedAdminId ?? actor.id,
          reviewedAt: row.reviewedAt ?? new Date(),
        },
      });
      if (res.count === 0) {
        throw new ConflictException('Request was updated by someone else');
      }
      await this.support.recordEvent(tx, {
        requestId: row.id,
        eventType: input.resolutionType,
        actorRole: 'ADMIN',
        actorUserId: actor.id,
        fromStatus: row.status,
        toStatus: NewGradeRequestStatus.GRADE_IDENTIFIED,
        message: input.message,
        metadata: { gradeId: input.gradeId },
      });
      if (input.internalNote?.trim()) {
        await this.support.recordEvent(tx, {
          requestId: row.id,
          eventType: 'INTERNAL_NOTE',
          actorRole: 'ADMIN',
          actorUserId: actor.id,
          internal: true,
          message: input.internalNote.trim(),
        });
      }
    });
    await this.support.audit({
      action: input.auditAction,
      actorUserId: actor.id,
      organizationId: row.customerProfile.organizationId,
      requestId: row.id,
      previousData: {
        status: row.status,
        resolvedGradeId: row.resolvedGradeId,
      },
      newData: {
        status: NewGradeRequestStatus.GRADE_IDENTIFIED,
        resolvedGradeId: input.gradeId,
        resolutionType: input.resolutionType,
      },
    });
    if (!sameStatus) {
      const n = this.support.statusNotification(
        row.referenceNumber,
        NewGradeRequestStatus.GRADE_IDENTIFIED,
        input.message,
      );
      await this.support.notifyCustomer(
        {
          id: row.id,
          referenceNumber: row.referenceNumber,
          requestedById: row.requestedById,
          organizationId: row.customerProfile.organizationId,
        },
        n.title,
        n.body,
        'NEW_GRADE_REQUEST_STATUS',
      );
    }
  }

  private async applyTransition(
    row: AdminRow,
    to: NewGradeRequestStatus,
    actor: Actor,
    opts: { message?: string; eventType: string },
  ) {
    if (row.status === to) {
      throw new BadRequestException({
        code: 'NO_CHANGE',
        message: `Request is already ${GRADE_REQUEST_STATUS_LABELS[to]}.`,
      });
    }
    if (!canTransition(row.status, to)) {
      throw new BadRequestException({
        code: 'INVALID_TRANSITION',
        message: `Cannot move from ${GRADE_REQUEST_STATUS_LABELS[row.status]} to ${GRADE_REQUEST_STATUS_LABELS[to]}.`,
      });
    }
    const terminal = TERMINAL_GRADE_REQUEST_STATUSES.includes(to);
    const message = opts.message?.trim() || null;

    await this.prisma.$transaction(async (tx) => {
      const res = await tx.newGradeRequest.updateMany({
        where: { id: row.id, status: row.status },
        data: {
          status: to,
          ...(message ? { adminMessage: message } : {}),
          ...(terminal ? { closedAt: new Date(), closureReason: message } : {}),
          assignedAdminId: row.assignedAdminId ?? actor.id,
          reviewedAt: row.reviewedAt ?? new Date(),
        },
      });
      if (res.count === 0) {
        throw new ConflictException('Request was updated by someone else');
      }
      await this.support.recordEvent(tx, {
        requestId: row.id,
        eventType: opts.eventType,
        actorRole: 'ADMIN',
        actorUserId: actor.id,
        fromStatus: row.status,
        toStatus: to,
        message,
      });
    });
    await this.support.audit({
      action: `NEW_GRADE_REQUEST_${to}`,
      actorUserId: actor.id,
      organizationId: row.customerProfile.organizationId,
      requestId: row.id,
      previousData: { status: row.status },
      newData: { status: to, message },
    });
    const n = this.support.statusNotification(row.referenceNumber, to, message);
    await this.support.notifyCustomer(
      {
        id: row.id,
        referenceNumber: row.referenceNumber,
        requestedById: row.requestedById,
        organizationId: row.customerProfile.organizationId,
      },
      n.title,
      n.body,
      'NEW_GRADE_REQUEST_STATUS',
    );
    return this.getById(row.id);
  }

  private async require(id: string): Promise<AdminRow> {
    const row = await this.prisma.newGradeRequest.findUnique({
      where: { id },
      include: adminInclude,
    });
    if (!row) throw new NotFoundException('Grade request not found');
    return row;
  }

  private toAdminView(row: AdminRow) {
    const u = row.customerProfile.user;
    return {
      id: row.id,
      referenceNumber: row.referenceNumber,
      status: row.status,
      statusLabel: GRADE_REQUEST_STATUS_LABELS[row.status],
      isOpen: OPEN_GRADE_REQUEST_STATUSES.includes(row.status),
      customer: {
        customerProfileId: row.customerProfile.id,
        organizationId: row.customerProfile.organizationId,
        companyName: row.customerProfile.organization.name,
        accountEmail: u.email,
        accountPhone: u.phone,
      },
      contact: {
        name: row.contactName,
        phone: row.contactPhone,
        email: row.contactEmail,
      },
      gradeName: row.gradeName,
      materialCategory: row.materialCategory,
      category: row.category
        ? {
            id: row.category.id,
            code: row.category.code,
            name: row.category.displayName || row.category.name,
          }
        : null,
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
      assignedAdmin: row.assignedAdmin
        ? { id: row.assignedAdmin.id, name: nameOf(row.assignedAdmin) }
        : null,
      resolvedGrade: row.resolvedGrade,
      resolutionType: row.resolutionType,
      adminMessage: row.adminMessage,
      customerResponse: row.customerResponse,
      closureReason: row.closureReason,
      submittedAt: row.submittedAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
