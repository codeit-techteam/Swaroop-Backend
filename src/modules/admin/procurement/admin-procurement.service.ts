import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NegotiationActorRole,
  Prisma,
  PurchaseRequestStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  NegotiationService,
  PrEventsService,
  ProcurementException,
  PrStateService,
} from '../../procurement/index.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import type {
  AdminCancelDto,
  AdminNoteDto,
  AdminProcurementPrQueryDto,
} from './admin-procurement.dto.js';

const orgSelect = {
  id: true,
  name: true,
  code: true,
  type: true,
  legalName: true,
} as const;

const adminPrInclude = {
  customerOrg: { select: orgSelect },
  sellerOrg: { select: orgSelect },
  customerProfile: {
    select: {
      id: true,
      status: true,
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
        },
      },
    },
  },
  items: {
    include: {
      grade: {
        select: { id: true, code: true, name: true, displayName: true },
      },
      product: { select: { id: true, code: true, name: true } },
      offer: { select: { id: true, referenceNumber: true } },
    },
  },
  counterOffers: {
    orderBy: [{ roundNumber: 'asc' as const }, { createdAt: 'asc' as const }],
  },
  purchaseOrders: {
    where: { deletedAt: null },
    take: 1,
    select: {
      id: true,
      referenceNumber: true,
      status: true,
      totalAmount: true,
      confirmedAt: true,
    },
  },
  events: {
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.PurchaseRequestInclude;

@Injectable()
export class AdminProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prState: PrStateService,
    private readonly prEvents: PrEventsService,
    private readonly negotiation: NegotiationService,
  ) {}

  async summary() {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const inFiveMin = new Date(now.getTime() + 5 * 60 * 1000);

    const [
      total,
      sourcing,
      negotiation,
      converted,
      rejected,
      expired,
      cancelled,
      expiringSoon,
      acceptedToday,
      pendingCounters,
    ] = await Promise.all([
      this.prisma.purchaseRequest.count({ where: { deletedAt: null } }),
      this.prisma.purchaseRequest.count({
        where: { deletedAt: null, status: PurchaseRequestStatus.SOURCING },
      }),
      this.prisma.purchaseRequest.count({
        where: { deletedAt: null, status: PurchaseRequestStatus.NEGOTIATION },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          status: PurchaseRequestStatus.CONVERTED_TO_ORDER,
        },
      }),
      this.prisma.purchaseRequest.count({
        where: { deletedAt: null, status: PurchaseRequestStatus.REJECTED },
      }),
      this.prisma.purchaseRequest.count({
        where: { deletedAt: null, status: PurchaseRequestStatus.EXPIRED },
      }),
      this.prisma.purchaseRequest.count({
        where: { deletedAt: null, status: PurchaseRequestStatus.CANCELLED },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          status: {
            in: [
              PurchaseRequestStatus.SOURCING,
              PurchaseRequestStatus.NEGOTIATION,
              PurchaseRequestStatus.OFFER_RECEIVED,
            ],
          },
          responseDeadline: { gt: now, lte: inFiveMin },
        },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          status: PurchaseRequestStatus.CONVERTED_TO_ORDER,
          commerciallyAcceptedAt: { gte: startOfDay },
        },
      }),
      this.prisma.counterOffer.count({
        where: { status: 'PENDING' },
      }),
    ]);

    return {
      total,
      byStatus: {
        sourcing,
        negotiation,
        convertedToOrder: converted,
        rejected,
        expired,
        cancelled,
      },
      expiringSoon,
      acceptedToday,
      pendingCounters,
    };
  }

  async list(query: AdminProcurementPrQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.PurchaseRequestWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search?.trim()
        ? {
            OR: [
              {
                referenceNumber: {
                  contains: query.search.trim(),
                  mode: 'insensitive',
                },
              },
              {
                customerOrg: {
                  name: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
              },
              {
                sellerOrg: {
                  name: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.purchaseRequest.count({ where }),
      this.prisma.purchaseRequest.findMany({
        where,
        include: adminPrInclude,
        orderBy: {
          createdAt: query.sortOrder === 'asc' ? 'asc' : 'desc',
        },
        skip,
        take,
      }),
    ]);

    return {
      items: items.map((pr) => this.toAdminPr(pr)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(id: string) {
    const pr = await this.prisma.purchaseRequest.findFirst({
      where: { id, deletedAt: null },
      include: adminPrInclude,
    });
    if (!pr) throw new NotFoundException('Purchase request not found');
    return this.toAdminPr(pr);
  }

  async timeline(id: string) {
    await this.ensureExists(id);
    const events = await this.prisma.purchaseRequestEvent.findMany({
      where: { purchaseRequestId: id },
      orderBy: { createdAt: 'asc' },
    });
    return { purchaseRequestId: id, events };
  }

  async negotiationHistory(id: string) {
    await this.ensureExists(id);
    const rounds = await this.negotiation.list(id);
    return {
      purchaseRequestId: id,
      rounds: this.negotiation.toAdminNegotiation(rounds),
    };
  }

  async addNote(id: string, actorUserId: string, dto: AdminNoteDto) {
    await this.ensureExists(id);
    await this.prEvents.record(this.prisma, {
      purchaseRequestId: id,
      eventType: 'ADMIN_NOTE_ADDED',
      actorRole: NegotiationActorRole.ADMIN,
      actorUserId,
      metadata: { note: dto.note },
    });
    return this.findOne(id);
  }

  async markReview(id: string, actorUserId: string) {
    const existing = await this.ensureExists(id);
    await this.prEvents.record(this.prisma, {
      purchaseRequestId: id,
      eventType: 'ADMIN_MARKED_FOR_REVIEW',
      actorRole: NegotiationActorRole.ADMIN,
      actorUserId,
    });
    const pr = await this.prisma.purchaseRequest.update({
      where: { id },
      data: {
        metadata: {
          ...((existing.metadata as object) ?? {}),
          adminReview: true,
          markedForReviewAt: new Date().toISOString(),
        },
      },
      include: adminPrInclude,
    });
    return this.toAdminPr(pr);
  }

  async escalate(id: string, actorUserId: string) {
    await this.ensureExists(id);
    await this.prEvents.record(this.prisma, {
      purchaseRequestId: id,
      eventType: 'ADMIN_ESCALATED',
      actorRole: NegotiationActorRole.ADMIN,
      actorUserId,
    });
    const existing = await this.prisma.purchaseRequest.findFirstOrThrow({
      where: { id },
    });
    const pr = await this.prisma.purchaseRequest.update({
      where: { id },
      data: {
        priority: 'URGENT',
        metadata: {
          ...((existing.metadata as object) ?? {}),
          escalated: true,
          escalatedAt: new Date().toISOString(),
        },
      },
      include: adminPrInclude,
    });
    return this.toAdminPr(pr);
  }

  async cancel(id: string, actorUserId: string, dto: AdminCancelDto) {
    const pr = await this.ensureExists(id);
    if (pr.status === PurchaseRequestStatus.CONVERTED_TO_ORDER) {
      throw new BadRequestException({
        code: 'INVALID_STATUS_TRANSITION',
        message:
          'Cannot cancel a purchase request that has been converted to order',
      });
    }
    if (this.prState.isTerminal(pr.status)) {
      throw new ProcurementException(
        'PURCHASE_REQUEST_ALREADY_RESPONDED',
        `Cannot cancel purchase request in status ${pr.status}`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.purchaseRequest.update({
        where: { id },
        data: {
          status: PurchaseRequestStatus.CANCELLED,
          rejectionReason: dto.reason,
        },
        include: adminPrInclude,
      });
      await this.prEvents.record(tx, {
        purchaseRequestId: id,
        eventType: 'PURCHASE_REQUEST_CANCELLED',
        actorRole: NegotiationActorRole.ADMIN,
        actorUserId,
        metadata: { reason: dto.reason },
      });
      return next;
    });

    return this.toAdminPr(updated);
  }

  private async ensureExists(id: string) {
    const pr = await this.prisma.purchaseRequest.findFirst({
      where: { id, deletedAt: null },
    });
    if (!pr) throw new NotFoundException('Purchase request not found');
    return pr;
  }

  private toAdminPr(
    pr: Prisma.PurchaseRequestGetPayload<{ include: typeof adminPrInclude }>,
  ) {
    return {
      id: pr.id,
      referenceNumber: pr.referenceNumber,
      status: pr.status,
      priority: pr.priority,
      paymentMethod: pr.paymentMethod,
      targetPrice: pr.targetPrice,
      currency: pr.currency,
      requiredByDate: pr.requiredByDate,
      destinationRegion: pr.destinationRegion,
      deliveryLocation: pr.deliveryLocation,
      notes: pr.notes,
      rejectionReason: pr.rejectionReason,
      expiresAt: pr.expiresAt,
      responseDeadline: pr.responseDeadline,
      remainingSeconds: this.prState.remainingSeconds(
        this.prState.deadlineOf(pr),
      ),
      viewedBySellerAt: pr.viewedBySellerAt,
      sellerRespondedAt: pr.sellerRespondedAt,
      commerciallyAcceptedAt: pr.commerciallyAcceptedAt,
      commercialSnapshot: pr.commercialSnapshot,
      submittedAt: pr.submittedAt,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      metadata: pr.metadata,
      customerOrg: pr.customerOrg
        ? {
            id: pr.customerOrg.id,
            name: pr.customerOrg.name,
            code: pr.customerOrg.code,
            type: pr.customerOrg.type,
            legalName: pr.customerOrg.legalName,
          }
        : null,
      sellerOrg: pr.sellerOrg
        ? {
            id: pr.sellerOrg.id,
            name: pr.sellerOrg.name,
            code: pr.sellerOrg.code,
            type: pr.sellerOrg.type,
            legalName: pr.sellerOrg.legalName,
          }
        : null,
      customerProfile: pr.customerProfile
        ? {
            id: pr.customerProfile.id,
            status: pr.customerProfile.status,
            user: pr.customerProfile.user
              ? {
                  id: pr.customerProfile.user.id,
                  email: pr.customerProfile.user.email,
                  firstName: pr.customerProfile.user.firstName,
                  lastName: pr.customerProfile.user.lastName,
                  phone: pr.customerProfile.user.phone,
                }
              : null,
          }
        : null,
      items: pr.items,
      counterOffers: this.negotiation.toAdminNegotiation(pr.counterOffers),
      purchaseOrder: pr.purchaseOrders?.[0] ?? null,
      eventCount: pr.events?.length ?? 0,
    };
  }
}
