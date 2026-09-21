import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryStatus,
  Prisma,
  PurchaseOrderStatus,
  ShipmentStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../../master-data/common/pagination.js';
import { CustomerContextService } from '../common/customer-context.service.js';
import { CustomerOrdersQueryDto } from './customer-orders.dto.js';
import {
  buildCustomerOrderTimeline,
  toCustomerOrderDto,
} from './customer-orders.mapper.js';
import { presentationBucketForPoStatus } from './customer-orders.progress.js';

const poInclude = {
  purchaseRequest: {
    select: {
      id: true,
      referenceNumber: true,
      status: true,
      items: {
        include: {
          grade: {
            select: {
              id: true,
              code: true,
              name: true,
              displayName: true,
              category: { select: { code: true, name: true } },
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
  procurementCase: {
    select: { id: true, referenceNumber: true, status: true },
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
  dispatches: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
    take: 10,
    select: {
      id: true,
      dispatchNumber: true,
      status: true,
      actualDispatchDate: true,
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
  creditTransactions: {
    orderBy: { createdAt: 'desc' as const },
    take: 10,
    select: {
      id: true,
      type: true,
      status: true,
      amount: true,
      createdAt: true,
    },
  },
} satisfies Prisma.PurchaseOrderInclude;

const ACTIVE_PO: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.DRAFT,
  PurchaseOrderStatus.SENT_TO_SELLER,
  PurchaseOrderStatus.SELLER_REVIEW,
  PurchaseOrderStatus.CONFIRMED,
  PurchaseOrderStatus.READY_FOR_DISPATCH,
  PurchaseOrderStatus.DISPATCHED,
  PurchaseOrderStatus.IN_TRANSIT,
];

const COMPLETED_PO: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.DELIVERED,
  PurchaseOrderStatus.COMPLETED,
];

const CANCELLED_PO: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.CANCELLED,
  PurchaseOrderStatus.REJECTED,
];

@Injectable()
export class CustomerOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerContext: CustomerContextService,
  ) {}

  private normalizeBucket(status?: string) {
    return (status ?? '').trim().toUpperCase();
  }

  private buildWhere(
    organizationId: string,
    query: CustomerOrdersQueryDto,
  ): Prisma.PurchaseOrderWhereInput {
    const where: Prisma.PurchaseOrderWhereInput = {
      customerOrgId: organizationId,
      deletedAt: null,
    };

    const bucket = this.normalizeBucket(query.status);
    if (bucket === 'ACTIVE') {
      where.status = { in: ACTIVE_PO };
    } else if (bucket === 'COMPLETED') {
      where.status = { in: COMPLETED_PO };
    } else if (bucket === 'CANCELLED') {
      where.status = { in: CANCELLED_PO };
    }

    const search =
      query.orderNumber?.trim() || resolveSearch(query) || undefined;
    if (search) {
      where.OR = [
        { referenceNumber: { contains: search, mode: 'insensitive' } },
        {
          purchaseRequest: {
            referenceNumber: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    if (query.paymentStatus?.trim()) {
      where.payments = {
        some: {
          status: query.paymentStatus.trim().toUpperCase() as never,
        },
      };
    }

    return where;
  }

  async list(userId: string, query: CustomerOrdersQueryDto) {
    const customer = await this.customerContext.requireCustomer(userId);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const where = this.buildWhere(customer.organizationId, query);

    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: poInclude,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    // Soft filter by presentation bucket when PO status alone is insufficient
    // (e.g. DELIVERED via shipment while PO still IN_TRANSIT).
    const bucket = this.normalizeBucket(query.status);
    const items = rows
      .map((po) => toCustomerOrderDto(po))
      .filter((dto) => {
        if (!bucket) return true;
        return dto.presentationBucket === bucket;
      });

    return {
      items,
      meta: paginationMeta(page, limit, total),
    };
  }

  async summary(userId: string) {
    const customer = await this.customerContext.requireCustomer(userId);
    const base = {
      customerOrgId: customer.organizationId,
      deletedAt: null,
    } satisfies Prisma.PurchaseOrderWhereInput;

    const [
      activeOrders,
      completedOrders,
      cancelledOrders,
      pendingPayments,
      inTransit,
    ] = await Promise.all([
      this.prisma.purchaseOrder.count({
        where: { ...base, status: { in: ACTIVE_PO } },
      }),
      this.prisma.purchaseOrder.count({
        where: { ...base, status: { in: COMPLETED_PO } },
      }),
      this.prisma.purchaseOrder.count({
        where: { ...base, status: { in: CANCELLED_PO } },
      }),
      this.prisma.purchaseOrder.count({
        where: {
          ...base,
          status: { notIn: CANCELLED_PO },
          payments: {
            some: {
              status: {
                in: ['PENDING', 'INITIATED', 'SUBMITTED', 'UNDER_VERIFICATION'],
              },
            },
          },
        },
      }),
      this.prisma.purchaseOrder.count({
        where: {
          ...base,
          OR: [
            { status: PurchaseOrderStatus.IN_TRANSIT },
            {
              shipments: {
                some: {
                  deletedAt: null,
                  status: {
                    in: [
                      ShipmentStatus.IN_TRANSIT,
                      ShipmentStatus.OUT_FOR_DELIVERY,
                      ShipmentStatus.DISPATCHED,
                    ],
                  },
                },
              },
            },
            {
              deliveries: {
                some: {
                  status: {
                    in: [
                      DeliveryStatus.OUT_FOR_DELIVERY,
                      DeliveryStatus.SCHEDULED,
                    ],
                  },
                },
              },
            },
          ],
        },
      }),
    ]);

    return {
      activeOrders,
      completedOrders,
      cancelledOrders,
      pendingPayments,
      inTransit,
    };
  }

  private async loadOwned(userId: string, id: string) {
    const customer = await this.customerContext.requireCustomer(userId);
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
    if (po.customerOrgId !== customer.organizationId) {
      throw new ForbiddenException({
        code: 'ORDER_ACCESS_DENIED',
        message: 'You do not have access to this order',
      });
    }
    return po;
  }

  async findOne(userId: string, id: string) {
    const po = await this.loadOwned(userId, id);
    return toCustomerOrderDto(po, { detailed: true });
  }

  async timeline(userId: string, id: string) {
    const po = await this.loadOwned(userId, id);
    return buildCustomerOrderTimeline(po);
  }

  async progress(userId: string, id: string) {
    const dto = await this.findOne(userId, id);
    return {
      percentage: dto.progress.percentage,
      stage: dto.progress.stage,
      status: dto.progress.status,
      label: dto.progress.label,
      presentationBucket: dto.presentationBucket,
      customerStatus: dto.status,
    };
  }

  /** Exposed for unit tests / admin reuse. */
  bucketFor(poStatus: PurchaseOrderStatus) {
    return presentationBucketForPoStatus(poStatus);
  }
}
