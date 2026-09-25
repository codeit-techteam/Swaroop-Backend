import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PurchaseOrderStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../../master-data/common/pagination.js';
import { SellerContextService } from '../common/seller-context.service.js';
import {
  type SellerOrderDisplayStatus,
  SellerOrdersQueryDto,
} from './seller-orders.dto.js';
import {
  buildSellerOrderTimeline,
  poStatusesForDisplayFilter,
  toSellerDisplayStatus,
  toSellerOrderDetailDto,
  toSellerOrderListDto,
} from './seller-orders.mapper.js';

const poInclude = {
  purchaseRequest: {
    select: {
      id: true,
      referenceNumber: true,
      status: true,
      destinationRegion: true,
      deliveryLocation: true,
      requiredByDate: true,
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
      events: {
        orderBy: { createdAt: 'asc' as const },
        take: 50,
        select: {
          id: true,
          eventType: true,
          createdAt: true,
          metadata: true,
        },
      },
    },
  },
  payments: {
    orderBy: { createdAt: 'desc' as const },
    take: 20,
    select: {
      id: true,
      referenceNumber: true,
      status: true,
      amount: true,
      verifiedAt: true,
      createdAt: true,
    },
  },
  proformaInvoices: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
    take: 10,
    select: {
      id: true,
      piNumber: true,
      status: true,
      totalAmount: true,
      createdAt: true,
    },
  },
  paymentSchedules: {
    orderBy: { sequence: 'asc' as const },
    take: 20,
    select: {
      id: true,
      sequence: true,
      status: true,
      amount: true,
      dueAt: true,
    },
  },
  dispatches: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
    take: 10,
    select: {
      id: true,
      dispatchNumber: true,
      status: true,
      plannedDispatchDate: true,
      actualDispatchDate: true,
      destinationRegion: true,
      createdAt: true,
    },
  },
  shipments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
    take: 10,
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
    take: 10,
    select: {
      id: true,
      status: true,
      deliveredAt: true,
      createdAt: true,
    },
  },
} satisfies Prisma.PurchaseOrderInclude;

@Injectable()
export class SellerOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerContext: SellerContextService,
  ) {}

  private normalizeDisplayStatus(
    status?: string,
  ): SellerOrderDisplayStatus | null {
    const raw = (status ?? '').trim().toUpperCase().replaceAll('-', '_');
    if (!raw || raw === 'ALL') return null;
    if (raw === 'IN_TRANSIT') return 'DISPATCHED';
    if (
      raw === 'CONFIRMED' ||
      raw === 'PROCESSING' ||
      raw === 'READY_FOR_DISPATCH' ||
      raw === 'DISPATCHED' ||
      raw === 'DELIVERED' ||
      raw === 'CANCELLED'
    ) {
      return raw;
    }
    return null;
  }

  private buildWhere(
    organizationId: string,
    query: SellerOrdersQueryDto,
  ): Prisma.PurchaseOrderWhereInput {
    const where: Prisma.PurchaseOrderWhereInput = {
      sellerOrgId: organizationId,
      deletedAt: null,
    };

    const display = this.normalizeDisplayStatus(query.status);
    if (display) {
      const statuses = poStatusesForDisplayFilter(display);
      if (statuses) {
        where.status = { in: statuses };
      }
    }

    const search = resolveSearch(query);
    if (search) {
      where.OR = [
        { referenceNumber: { contains: search, mode: 'insensitive' } },
        {
          purchaseRequest: {
            referenceNumber: { contains: search, mode: 'insensitive' },
          },
        },
        {
          purchaseRequest: {
            items: {
              some: {
                OR: [
                  {
                    grade: {
                      OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        {
                          displayName: {
                            contains: search,
                            mode: 'insensitive',
                          },
                        },
                        { code: { contains: search, mode: 'insensitive' } },
                      ],
                    },
                  },
                  {
                    product: {
                      OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        { code: { contains: search, mode: 'insensitive' } },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ];
    }

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    return where;
  }

  private orderBy(
    query: SellerOrdersQueryDto,
  ): Prisma.PurchaseOrderOrderByWithRelationInput {
    const dir = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const sortBy = (query.sortBy ?? 'createdAt').trim();
    if (sortBy === 'status') return { status: dir };
    if (sortBy === 'referenceNumber' || sortBy === 'poNumber') {
      return { referenceNumber: dir };
    }
    if (sortBy === 'totalAmount' || sortBy === 'orderValue') {
      return { totalAmount: dir };
    }
    return { createdAt: dir };
  }

  async list(userId: string, query: SellerOrdersQueryDto) {
    const seller = await this.sellerContext.requireSeller(userId);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const where = this.buildWhere(seller.organizationId, query);
    const display = this.normalizeDisplayStatus(query.status);

    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: this.orderBy(query),
        skip,
        take,
        include: poInclude,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    // Soft filter for PROCESSING / CONFIRMED which share CONFIRMED PO status.
    const items = rows
      .map((po) => toSellerOrderListDto(po))
      .filter((dto) => {
        if (!display) return true;
        if (display === 'PROCESSING' || display === 'CONFIRMED') {
          return dto.status === display;
        }
        return true;
      });

    return {
      items,
      meta: paginationMeta(page, limit, total),
    };
  }

  async summary(userId: string) {
    const seller = await this.sellerContext.requireSeller(userId);
    const base = {
      sellerOrgId: seller.organizationId,
      deletedAt: null,
    } satisfies Prisma.PurchaseOrderWhereInput;

    // Load lightweight rows for accurate display-status buckets.
    const rows = await this.prisma.purchaseOrder.findMany({
      where: base,
      select: {
        id: true,
        status: true,
        customerOrgId: true,
        currency: true,
        subtotal: true,
        taxAmount: true,
        totalAmount: true,
        paymentMethod: true,
        orderedQuantity: true,
        dispatchedQuantity: true,
        deliveredQuantity: true,
        confirmedAt: true,
        createdAt: true,
        updatedAt: true,
        metadata: true,
        purchaseRequestId: true,
        referenceNumber: true,
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            referenceNumber: true,
            status: true,
            amount: true,
            verifiedAt: true,
            createdAt: true,
          },
        },
        proformaInvoices: {
          where: { deletedAt: null },
          take: 1,
          select: {
            id: true,
            piNumber: true,
            status: true,
            totalAmount: true,
            createdAt: true,
          },
        },
        dispatches: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            dispatchNumber: true,
            status: true,
            plannedDispatchDate: true,
            actualDispatchDate: true,
            destinationRegion: true,
            createdAt: true,
          },
        },
        shipments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            referenceNumber: true,
            status: true,
            eta: true,
            createdAt: true,
          },
        },
        deliveries: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            deliveredAt: true,
            createdAt: true,
          },
        },
      },
    });

    const counts = {
      total: rows.length,
      confirmed: 0,
      processing: 0,
      readyForDispatch: 0,
      dispatched: 0,
      delivered: 0,
      cancelled: 0,
    };

    for (const row of rows) {
      const status = toSellerDisplayStatus(row);
      switch (status) {
        case 'CONFIRMED':
          counts.confirmed += 1;
          break;
        case 'PROCESSING':
          counts.processing += 1;
          break;
        case 'READY_FOR_DISPATCH':
          counts.readyForDispatch += 1;
          break;
        case 'DISPATCHED':
          counts.dispatched += 1;
          break;
        case 'DELIVERED':
          counts.delivered += 1;
          break;
        case 'CANCELLED':
          counts.cancelled += 1;
          break;
        default:
          break;
      }
    }

    return counts;
  }

  private async loadOwned(userId: string, id: string) {
    const seller = await this.sellerContext.requireSeller(userId);
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: poInclude,
    });
    if (!po) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }
    if (po.sellerOrgId !== seller.organizationId) {
      throw new ForbiddenException({
        code: 'ORDER_ACCESS_DENIED',
        message: 'You do not have access to this order',
      });
    }
    return po;
  }

  async findOne(userId: string, id: string) {
    const po = await this.loadOwned(userId, id);
    return toSellerOrderDetailDto(po);
  }

  async timeline(userId: string, id: string) {
    const po = await this.loadOwned(userId, id);
    return buildSellerOrderTimeline(po);
  }

  /** Exposed for tests. */
  displayStatusFor(poStatus: PurchaseOrderStatus) {
    return toSellerDisplayStatus({
      id: 'x',
      referenceNumber: 'PO-TEST',
      purchaseRequestId: null,
      customerOrgId: 'org',
      status: poStatus,
      currency: 'INR',
      subtotal: 0,
      taxAmount: 0,
      totalAmount: 0,
      paymentMethod: null,
      orderedQuantity: 0,
      dispatchedQuantity: 0,
      deliveredQuantity: 0,
      confirmedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: null,
    });
  }
}
