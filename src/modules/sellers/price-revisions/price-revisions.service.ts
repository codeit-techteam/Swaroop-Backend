import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityOwnerType, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../../master-data/common/pagination.js';
import { SellerAuditService } from '../common/seller-audit.service.js';
import { SellerContextService } from '../common/seller-context.service.js';
import { PurchaseRequestsService } from '../purchase-requests/purchase-requests.service.js';
import {
  mapSellerPriceRevisionStatus,
  toBlindSellerPriceRevision,
  type SellerPriceRevisionStatus,
} from './blind-price-revision.mapper.js';
import type {
  SellerPriceRevisionAcceptDto,
  SellerPriceRevisionCounterDto,
  SellerPriceRevisionQueryDto,
  SellerPriceRevisionRejectDto,
} from './price-revisions.dto.js';

const revisionInclude = {
  purchaseRequest: {
    select: {
      id: true,
      referenceNumber: true,
      customerOrgId: true,
      currency: true,
      paymentMethod: true,
      destinationRegion: true,
      deliveryLocation: true,
      requiredByDate: true,
      responseDeadline: true,
      expiresAt: true,
      status: true,
      sellerOrgId: true,
      sellerRespondedAt: true,
      items: {
        take: 5,
        include: {
          grade: {
            select: {
              id: true,
              code: true,
              name: true,
              displayName: true,
            },
          },
          product: { select: { id: true, code: true, name: true } },
        },
      },
      purchaseOrders: {
        take: 1,
        orderBy: { createdAt: 'desc' as const },
        select: { id: true, referenceNumber: true, status: true },
      },
      counterOffers: {
        orderBy: { createdAt: 'asc' as const },
        take: 40,
        select: {
          id: true,
          createdByRole: true,
          unitPrice: true,
          quantity: true,
          note: true,
          status: true,
          createdAt: true,
        },
      },
      sellerMatches: {
        select: { sellerOrgId: true },
      },
    },
  },
  offer: {
    select: {
      id: true,
      referenceNumber: true,
      organizationId: true,
      basePrice: true,
      currency: true,
      product: { select: { id: true, code: true, name: true } },
      grade: {
        select: {
          id: true,
          code: true,
          name: true,
          displayName: true,
        },
      },
    },
  },
} satisfies Prisma.PriceRevisionInclude;

@Injectable()
export class SellerPriceRevisionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerContext: SellerContextService,
    private readonly audit: SellerAuditService,
    private readonly purchaseRequests: PurchaseRequestsService,
  ) {}

  private sellerScope(organizationId: string): Prisma.PriceRevisionWhereInput {
    return {
      OR: [
        { purchaseRequest: { sellerOrgId: organizationId } },
        {
          purchaseRequest: {
            sellerMatches: { some: { sellerOrgId: organizationId } },
          },
        },
        { offer: { organizationId, deletedAt: null } },
      ],
    };
  }

  private buildWhere(
    organizationId: string,
    query: SellerPriceRevisionQueryDto,
  ): Prisma.PriceRevisionWhereInput {
    const where: Prisma.PriceRevisionWhereInput = {
      AND: [this.sellerScope(organizationId)],
    };

    const search = resolveSearch(query);
    if (search) {
      const q = search;
      where.AND = [
        ...(where.AND as Prisma.PriceRevisionWhereInput[]),
        {
          OR: [
            { id: { equals: q, mode: 'insensitive' } },
            { reason: { contains: q, mode: 'insensitive' } },
            {
              purchaseRequest: {
                referenceNumber: { contains: q, mode: 'insensitive' },
              },
            },
            {
              purchaseRequest: {
                items: {
                  some: {
                    OR: [
                      {
                        product: { name: { contains: q, mode: 'insensitive' } },
                      },
                      { grade: { name: { contains: q, mode: 'insensitive' } } },
                      {
                        grade: {
                          displayName: { contains: q, mode: 'insensitive' },
                        },
                      },
                      { grade: { code: { contains: q, mode: 'insensitive' } } },
                    ],
                  },
                },
              },
            },
            {
              offer: {
                referenceNumber: { contains: q, mode: 'insensitive' },
              },
            },
            {
              offer: {
                product: { name: { contains: q, mode: 'insensitive' } },
              },
            },
            {
              offer: {
                grade: { name: { contains: q, mode: 'insensitive' } },
              },
            },
            {
              purchaseRequest: {
                purchaseOrders: {
                  some: {
                    referenceNumber: { contains: q, mode: 'insensitive' },
                  },
                },
              },
            },
          ],
        },
      ];
    }

    if (query.gradeId) {
      where.AND = [
        ...(where.AND as Prisma.PriceRevisionWhereInput[]),
        {
          OR: [
            {
              purchaseRequest: {
                items: { some: { gradeId: query.gradeId } },
              },
            },
            { offer: { gradeId: query.gradeId } },
          ],
        },
      ];
    }

    if (query.from || query.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.from) createdAt.gte = new Date(query.from);
      if (query.to) {
        const end = new Date(query.to);
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
      where.AND = [
        ...(where.AND as Prisma.PriceRevisionWhereInput[]),
        { createdAt },
      ];
    }

    const status = (query.status ?? '').trim().toUpperCase();
    if (status && status !== 'ALL') {
      if (status === 'ACCEPTED') {
        where.AND = [
          ...(where.AND as Prisma.PriceRevisionWhereInput[]),
          { status: { in: ['APPLIED', 'ACCEPTED'] } },
        ];
      } else if (status === 'REJECTED' || status === 'CANCELLED') {
        where.AND = [
          ...(where.AND as Prisma.PriceRevisionWhereInput[]),
          { status },
        ];
      } else if (
        status === 'PENDING' ||
        status === 'AWAITING_RESPONSE' ||
        status === 'COUNTER_OFFER' ||
        status === 'EXPIRED'
      ) {
        // Display statuses map from PENDING rows + deadline/metadata.
        where.AND = [
          ...(where.AND as Prisma.PriceRevisionWhereInput[]),
          { status: 'PENDING' },
        ];
      }
    }

    return where;
  }

  private orderBy(sort?: string): Prisma.PriceRevisionOrderByWithRelationInput {
    switch ((sort ?? 'newest').toLowerCase()) {
      case 'oldest':
        return { createdAt: 'asc' };
      case 'highest':
        return { proposedPrice: 'desc' };
      case 'lowest':
        return { proposedPrice: 'asc' };
      default:
        return { createdAt: 'desc' };
    }
  }

  async list(userId: string, query: SellerPriceRevisionQueryDto) {
    const ctx = await this.sellerContext.requireSeller(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where = this.buildWhere(ctx.organizationId, query);
    const displayStatus = (query.status ?? '').trim().toUpperCase();
    const needsDisplayFilter =
      displayStatus === 'PENDING' ||
      displayStatus === 'AWAITING_RESPONSE' ||
      displayStatus === 'COUNTER_OFFER' ||
      displayStatus === 'EXPIRED';

    if (!needsDisplayFilter) {
      const [rows, total] = await Promise.all([
        this.prisma.priceRevision.findMany({
          where,
          skip,
          take,
          orderBy: this.orderBy(query.sort),
          include: revisionInclude,
        }),
        this.prisma.priceRevision.count({ where }),
      ]);

      return {
        items: rows.map((row) => toBlindSellerPriceRevision(row)),
        meta: paginationMeta(page, limit, total),
      };
    }

    // Display-status filters require mapping (deadline / counter metadata).
    const rows = await this.prisma.priceRevision.findMany({
      where,
      orderBy: this.orderBy(query.sort),
      include: revisionInclude,
    });
    const mapped = rows
      .map((row) => toBlindSellerPriceRevision(row))
      .filter((item) => {
        if (displayStatus === 'COUNTER_OFFER') {
          return (
            item.status === 'COUNTER_OFFER' ||
            item.status === 'AWAITING_RESPONSE'
          );
        }
        return item.status === displayStatus;
      });
    const total = mapped.length;
    const items = mapped.slice(skip, skip + take);

    return {
      items,
      meta: paginationMeta(page, limit, total),
    };
  }

  async summary(userId: string) {
    const ctx = await this.sellerContext.requireSeller(userId);
    const scope = this.sellerScope(ctx.organizationId);
    const rows = await this.prisma.priceRevision.findMany({
      where: scope,
      select: {
        status: true,
        metadata: true,
        purchaseRequest: {
          select: {
            responseDeadline: true,
            expiresAt: true,
            sellerRespondedAt: true,
          },
        },
      },
    });

    const counts: Record<SellerPriceRevisionStatus, number> = {
      PENDING: 0,
      AWAITING_RESPONSE: 0,
      COUNTER_OFFER: 0,
      ACCEPTED: 0,
      REJECTED: 0,
      EXPIRED: 0,
      CANCELLED: 0,
    };

    for (const row of rows) {
      const meta =
        row.metadata &&
        typeof row.metadata === 'object' &&
        !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      const hasSellerCounter =
        Boolean(meta.counterOfferId) ||
        Boolean(row.purchaseRequest?.sellerRespondedAt);
      const deadline =
        row.purchaseRequest?.responseDeadline ??
        row.purchaseRequest?.expiresAt ??
        null;
      const mapped = mapSellerPriceRevisionStatus(row.status, {
        responseDeadline: deadline,
        hasSellerCounter,
        awaitingBuyer:
          hasSellerCounter && row.status.toUpperCase() === 'PENDING',
      });
      counts[mapped] += 1;
      if (mapped === 'AWAITING_RESPONSE') {
        counts.COUNTER_OFFER += 1;
      }
    }

    return {
      pending: counts.PENDING,
      awaitingResponse: counts.AWAITING_RESPONSE,
      accepted: counts.ACCEPTED,
      counterOffers: counts.COUNTER_OFFER,
      rejected: counts.REJECTED,
      expired: counts.EXPIRED,
      cancelled: counts.CANCELLED,
    };
  }

  private async loadOwned(userId: string, id: string) {
    const ctx = await this.sellerContext.requireSeller(userId);
    const row = await this.prisma.priceRevision.findFirst({
      where: { id, ...this.sellerScope(ctx.organizationId) },
      include: revisionInclude,
    });
    if (!row) throw new NotFoundException('Price revision not found');
    return { ctx, row };
  }

  async findOne(userId: string, id: string) {
    const { ctx, row } = await this.loadOwned(userId, id);
    await this.audit.log({
      action: 'PRICE_REVISION_VIEWED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PURCHASE_REQUEST,
      entityId: row.purchaseRequestId ?? row.offerId ?? row.id,
      newData: { priceRevisionId: row.id },
    });
    return toBlindSellerPriceRevision(row);
  }

  async timeline(userId: string, id: string) {
    const dto = await this.findOne(userId, id);
    return {
      id: dto.id,
      requestNumber: dto.requestNumber,
      status: dto.status,
      buyer: dto.buyer,
      timeline: dto.timeline,
    };
  }

  private assertActionable(row: {
    status: string;
    purchaseRequestId: string | null;
    purchaseRequest?: {
      responseDeadline: Date | null;
      expiresAt: Date | null;
    } | null;
  }) {
    if (!row.purchaseRequestId) {
      throw new BadRequestException(
        'Only purchase-request linked price revisions can be actioned by sellers',
      );
    }
    const deadline =
      row.purchaseRequest?.responseDeadline ??
      row.purchaseRequest?.expiresAt ??
      null;
    if (deadline && deadline.getTime() < Date.now()) {
      throw new ConflictException('Response deadline has expired.');
    }
    const status = row.status.toUpperCase();
    if (status !== 'PENDING' && status !== 'COUNTER_OFFER') {
      throw new ConflictException(
        'This price revision has already been responded to.',
      );
    }
  }

  async accept(userId: string, id: string, dto: SellerPriceRevisionAcceptDto) {
    const { ctx, row } = await this.loadOwned(userId, id);
    this.assertActionable(row);

    const result = await this.purchaseRequests.accept(
      userId,
      row.purchaseRequestId!,
      { message: dto.message },
    );

    const updated = await this.prisma.priceRevision.update({
      where: { id },
      data: {
        status: 'APPLIED',
        metadata: {
          ...((row.metadata as object) ?? {}),
          acceptedBy: userId,
          acceptedAt: new Date().toISOString(),
        },
      },
      include: revisionInclude,
    });

    await this.audit.log({
      action: 'PRICE_REVISION_ACCEPTED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PURCHASE_REQUEST,
      entityId: row.purchaseRequestId!,
      newData: { priceRevisionId: id },
    });

    return {
      revision: toBlindSellerPriceRevision(updated),
      purchaseRequest: result.purchaseRequest,
    };
  }

  async reject(userId: string, id: string, dto: SellerPriceRevisionRejectDto) {
    const { ctx, row } = await this.loadOwned(userId, id);
    this.assertActionable(row);

    const reason = dto.reason?.trim() || dto.message?.trim() || 'Rejected';
    const result = await this.purchaseRequests.reject(
      userId,
      row.purchaseRequestId!,
      {
        rejectionReason: reason,
        message: dto.message,
      },
    );

    const updated = await this.prisma.priceRevision.update({
      where: { id },
      data: {
        status: 'REJECTED',
        metadata: {
          ...((row.metadata as object) ?? {}),
          rejectedBy: userId,
          rejectReason: reason,
          rejectedAt: new Date().toISOString(),
        },
      },
      include: revisionInclude,
    });

    await this.audit.log({
      action: 'PRICE_REVISION_REJECTED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PURCHASE_REQUEST,
      entityId: row.purchaseRequestId!,
      newData: { priceRevisionId: id },
    });

    return {
      revision: toBlindSellerPriceRevision(updated),
      purchaseRequest: result.purchaseRequest,
    };
  }

  async counter(
    userId: string,
    id: string,
    dto: SellerPriceRevisionCounterDto,
  ) {
    const { ctx, row } = await this.loadOwned(userId, id);
    this.assertActionable(row);

    if (!(dto.counterPrice > 0)) {
      throw new BadRequestException('counterPrice must be positive');
    }

    const result = await this.purchaseRequests.counterOffer(
      userId,
      row.purchaseRequestId!,
      {
        counterPrice: dto.counterPrice,
        counterQuantity: dto.counterQuantity,
        message: dto.message,
      },
    );

    const counterOfferId =
      result.revision &&
      typeof result.revision === 'object' &&
      result.revision !== null &&
      'id' in result.revision
        ? String((result.revision as { id: string }).id)
        : null;

    await this.prisma.priceRevision.update({
      where: { id },
      data: {
        metadata: {
          ...((row.metadata as object) ?? {}),
          supersededBy: counterOfferId,
          counteredBy: userId,
          counterPrice: dto.counterPrice,
          counteredAt: new Date().toISOString(),
          counterOfferId:
            typeof row.metadata === 'object' &&
            row.metadata &&
            'counterOfferId' in (row.metadata as object)
              ? (row.metadata as { counterOfferId?: string }).counterOfferId
              : true,
        },
      },
    });

    let dtoOut = toBlindSellerPriceRevision(
      await this.prisma.priceRevision.findFirstOrThrow({
        where: { id },
        include: revisionInclude,
      }),
    );

    if (counterOfferId && counterOfferId !== id) {
      const fresh = await this.prisma.priceRevision.findFirst({
        where: {
          id: counterOfferId,
          ...this.sellerScope(ctx.organizationId),
        },
        include: revisionInclude,
      });
      if (fresh) dtoOut = toBlindSellerPriceRevision(fresh);
    }

    await this.audit.log({
      action: 'PRICE_REVISION_COUNTERED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PURCHASE_REQUEST,
      entityId: row.purchaseRequestId!,
      newData: { priceRevisionId: id, counterPrice: dto.counterPrice },
    });

    return {
      revision: dtoOut,
      purchaseRequest: result.purchaseRequest,
    };
  }

  /** Guard helper for IDOR tests — never trust client sellerId. */
  async assertNotCrossSeller(userId: string, revisionId: string) {
    const ctx = await this.sellerContext.requireSeller(userId);
    const row = await this.prisma.priceRevision.findUnique({
      where: { id: revisionId },
      include: {
        purchaseRequest: { select: { sellerOrgId: true, sellerMatches: true } },
        offer: { select: { organizationId: true } },
      },
    });
    if (!row) throw new NotFoundException('Price revision not found');
    const owned =
      row.purchaseRequest?.sellerOrgId === ctx.organizationId ||
      row.purchaseRequest?.sellerMatches?.some(
        (m) => m.sellerOrgId === ctx.organizationId,
      ) ||
      row.offer?.organizationId === ctx.organizationId;
    if (!owned) throw new ForbiddenException('Access denied');
    return true;
  }
}
