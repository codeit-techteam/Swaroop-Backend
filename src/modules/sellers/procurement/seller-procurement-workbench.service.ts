import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  PurchaseRequestSellerMatchStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { assertBlindSellerPayload } from '../common/blind-buyer.js';
import {
  SellerContext,
  SellerContextService,
} from '../common/seller-context.service.js';
import type { SellerProcurementWorkbenchQueryDto } from './seller-procurement-workbench.dto.js';
import {
  type SellerBlindProcurementItem,
  toSellerBlindProcurementItem,
} from './seller-procurement-workbench.mapper.js';

const SELLER_VISIBLE_MATCH_STATUSES: PurchaseRequestSellerMatchStatus[] = [
  PurchaseRequestSellerMatchStatus.MATCHED,
  PurchaseRequestSellerMatchStatus.VIEWED,
  PurchaseRequestSellerMatchStatus.ACCEPTED,
  PurchaseRequestSellerMatchStatus.COUNTER_OFFERED,
  PurchaseRequestSellerMatchStatus.REJECTED,
  PurchaseRequestSellerMatchStatus.EXPIRED,
];

const workbenchInclude = {
  items: {
    take: 1,
    include: {
      grade: {
        select: { id: true, code: true, name: true, displayName: true },
      },
      product: { select: { id: true, code: true, name: true } },
    },
  },
  priceRevisions: {
    orderBy: { updatedAt: 'desc' as const },
    take: 5,
    select: {
      id: true,
      status: true,
      previousPrice: true,
      proposedPrice: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  counterOffers: {
    orderBy: { createdAt: 'desc' as const },
    take: 10,
    select: {
      id: true,
      status: true,
      createdByRole: true,
      unitPrice: true,
      createdAt: true,
    },
  },
  purchaseOrders: {
    where: { deletedAt: null },
    take: 1,
    select: {
      id: true,
      referenceNumber: true,
      status: true,
      totalAmount: true,
      orderedQuantity: true,
      confirmedAt: true,
      createdAt: true,
      updatedAt: true,
      payments: {
        orderBy: { createdAt: 'desc' as const },
        take: 5,
        select: {
          id: true,
          status: true,
          amount: true,
          createdAt: true,
        },
      },
      dispatches: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' as const },
        take: 5,
        select: {
          id: true,
          dispatchNumber: true,
          status: true,
          plannedDispatchDate: true,
          createdAt: true,
          slots: {
            take: 3,
            select: { id: true, status: true },
          },
        },
      },
      shipments: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' as const },
        take: 5,
        select: {
          id: true,
          referenceNumber: true,
          status: true,
          eta: true,
          createdAt: true,
        },
      },
      deliveries: {
        orderBy: { createdAt: 'desc' as const },
        take: 5,
        select: {
          id: true,
          status: true,
          deliveredAt: true,
        },
      },
    },
  },
} satisfies Prisma.PurchaseRequestInclude;

@Injectable()
export class SellerProcurementWorkbenchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerContext: SellerContextService,
  ) {}

  private async ctx(userId: string) {
    return this.sellerContext.requireSeller(userId);
  }

  private inboxWhere(ctx: SellerContext): Prisma.PurchaseRequestWhereInput {
    return {
      deletedAt: null,
      OR: [
        {
          sellerMatches: {
            some: {
              sellerOrgId: ctx.organizationId,
              status: { in: SELLER_VISIBLE_MATCH_STATUSES },
            },
          },
        },
        {
          AND: [
            { sellerOrgId: ctx.organizationId },
            { sellerMatches: { none: {} } },
          ],
        },
      ],
    };
  }

  private buildSearchFilter(
    search?: string,
  ): Prisma.PurchaseRequestWhereInput | undefined {
    const q = search?.trim();
    if (!q) return undefined;
    // Blind search: PR / PO / product / grade only — never customer name/email/GSTIN.
    return {
      OR: [
        { referenceNumber: { contains: q, mode: 'insensitive' } },
        {
          items: {
            some: {
              OR: [
                { product: { name: { contains: q, mode: 'insensitive' } } },
                { product: { code: { contains: q, mode: 'insensitive' } } },
                { grade: { name: { contains: q, mode: 'insensitive' } } },
                { grade: { code: { contains: q, mode: 'insensitive' } } },
                {
                  grade: {
                    displayName: { contains: q, mode: 'insensitive' },
                  },
                },
              ],
            },
          },
        },
        {
          purchaseOrders: {
            some: {
              deletedAt: null,
              OR: [
                { referenceNumber: { contains: q, mode: 'insensitive' } },
                {
                  dispatches: {
                    some: {
                      deletedAt: null,
                      dispatchNumber: { contains: q, mode: 'insensitive' },
                    },
                  },
                },
                {
                  shipments: {
                    some: {
                      deletedAt: null,
                      referenceNumber: {
                        contains: q,
                        mode: 'insensitive',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    };
  }

  private matchesClientFilters(
    item: SellerBlindProcurementItem,
    query: SellerProcurementWorkbenchQueryDto,
  ): boolean {
    if (query.stage && item.currentStage !== query.stage) return false;
    if (query.gradeId && item.gradeId !== query.gradeId) return false;
    if (query.priority && item.priority !== query.priority) return false;
    if (query.paymentStatus && item.paymentStatus !== query.paymentStatus) {
      return false;
    }
    if (query.dispatchStatus && item.dispatchStatus !== query.dispatchStatus) {
      return false;
    }
    if (query.alert && !item.alerts.includes(query.alert)) return false;
    if (query.date) {
      const day = query.date.slice(0, 10);
      if (item.lastUpdatedAt.slice(0, 10) !== day) return false;
    }
    if (query.fromDate) {
      if (item.lastUpdatedAt < query.fromDate) return false;
    }
    if (query.toDate) {
      if (item.lastUpdatedAt > `${query.toDate.slice(0, 10)}T23:59:59.999Z`) {
        return false;
      }
    }
    return true;
  }

  async list(userId: string, query: SellerProcurementWorkbenchQueryDto) {
    const ctx = await this.ctx(userId);
    const { page, limit } = skipTake(query.page, query.limit);

    const where: Prisma.PurchaseRequestWhereInput = {
      AND: [
        this.inboxWhere(ctx),
        this.buildSearchFilter(query.search) ?? {},
        query.gradeId ? { items: { some: { gradeId: query.gradeId } } } : {},
      ],
    };

    // Fetch a bounded window then apply derived-stage filters in memory.
    // Stage/payment/dispatch are computed fields, not raw DB columns.
    const rows = await this.prisma.purchaseRequest.findMany({
      where,
      include: workbenchInclude,
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });

    const mapped = rows.map((row) => {
      const dto = toSellerBlindProcurementItem(row);
      assertBlindSellerPayload(dto, 'Seller procurement workbench item');
      return dto;
    });

    const filtered = mapped.filter((item) =>
      this.matchesClientFilters(item, query),
    );
    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);

    return {
      items,
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    const row = await this.prisma.purchaseRequest.findFirst({
      where: {
        id,
        AND: [this.inboxWhere(ctx)],
      },
      include: workbenchInclude,
    });
    if (!row) throw new NotFoundException('Procurement record not found');
    const dto = toSellerBlindProcurementItem(row);
    assertBlindSellerPayload(dto, 'Seller procurement workbench detail');
    return dto;
  }

  async summary(userId: string) {
    const ctx = await this.ctx(userId);
    const rows = await this.prisma.purchaseRequest.findMany({
      where: this.inboxWhere(ctx),
      include: workbenchInclude,
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    const items = rows.map((row) => toSellerBlindProcurementItem(row));

    const countStage = (stage: SellerBlindProcurementItem['currentStage']) =>
      items.filter((i) => i.currentStage === stage).length;

    const countAlert = (alert: SellerBlindProcurementItem['alerts'][number]) =>
      items.filter((i) => i.alerts.includes(alert)).length;

    const summary = {
      kpis: {
        openPurchaseRequests:
          countStage('PR') + countStage('COMMERCIAL_REVIEW'),
        pendingPriceRevisions: countStage('PRICE_REVISION'),
        confirmedOrders: countStage('PO'),
        awaitingPayment: countStage('PAYMENT'),
        readyForDispatch: countStage('DISPATCH'),
        inTransit: countStage('SHIPMENT'),
        settlementPending: countStage('SETTLEMENT'),
      },
      pipeline: {
        PR: countStage('PR'),
        COMMERCIAL_REVIEW: countStage('COMMERCIAL_REVIEW'),
        PRICE_REVISION: countStage('PRICE_REVISION'),
        PO: countStage('PO'),
        PAYMENT: countStage('PAYMENT'),
        DISPATCH: countStage('DISPATCH'),
        SHIPMENT: countStage('SHIPMENT'),
        SETTLEMENT: countStage('SETTLEMENT'),
      },
      actionRequired: {
        PRICE_REVISION_DUE_TODAY: countAlert('PRICE_REVISION_DUE_TODAY'),
        PAYMENT_PENDING: countAlert('PAYMENT_PENDING'),
        VEHICLE_SLOT_MISSING: countAlert('VEHICLE_SLOT_MISSING'),
        PO_AWAITING_CONFIRMATION: countAlert('PO_AWAITING_CONFIRMATION'),
        DOCUMENTS_MISSING: countAlert('DOCUMENTS_MISSING'),
        DISPATCH_DELAYED: countAlert('DISPATCH_DELAYED'),
      },
      total: items.length,
    };

    assertBlindSellerPayload(summary, 'Seller procurement workbench summary');
    return summary;
  }
}
