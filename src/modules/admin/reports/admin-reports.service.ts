import { Injectable } from '@nestjs/common';
import { InventoryStatus, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { AdminDateRangeQueryDto } from '../common/admin-query.dto.js';

function dateWhere(
  from?: string,
  to?: string,
): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const filter: Prisma.DateTimeFilter = {};
  if (from) filter.gte = new Date(from);
  if (to) filter.lte = new Date(to);
  return filter;
}

@Injectable()
export class AdminReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private range(query: AdminDateRangeQueryDto) {
    return dateWhere(query.from, query.to);
  }

  async overview(query: AdminDateRangeQueryDto) {
    const createdAt = this.range(query);
    const where = createdAt ? { createdAt } : {};

    const [
      users,
      customers,
      sellers,
      purchaseRequests,
      purchaseOrders,
      payments,
      offers,
      shipments,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null, ...where } }),
      this.prisma.customerProfile.count({
        where: { deletedAt: null, ...where },
      }),
      this.prisma.sellerProfile.count({
        where: { deletedAt: null, ...where },
      }),
      this.prisma.purchaseRequest.count({
        where: { deletedAt: null, ...where },
      }),
      this.prisma.purchaseOrder.count({
        where: { deletedAt: null, ...where },
      }),
      this.prisma.payment.count({ where }),
      this.prisma.offer.count({ where: { deletedAt: null, ...where } }),
      this.prisma.shipment.count({ where: { deletedAt: null, ...where } }),
    ]);

    return {
      users,
      customers,
      sellers,
      purchaseRequests,
      purchaseOrders,
      payments,
      offers,
      shipments,
      from: query.from ?? null,
      to: query.to ?? null,
    };
  }

  async sales(query: AdminDateRangeQueryDto) {
    const createdAt = this.range(query);
    const where: Prisma.PurchaseOrderWhereInput = {
      deletedAt: null,
      ...(createdAt ? { createdAt } : {}),
    };

    const [byStatus, totals] = await Promise.all([
      this.prisma.purchaseOrder.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.purchaseOrder.aggregate({
        where,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      count: totals._count._all,
      totalAmount: totals._sum.totalAmount?.toString() ?? '0.00',
      byStatus: byStatus.map((row) => ({
        status: row.status,
        count: row._count._all,
        totalAmount: row._sum.totalAmount?.toString() ?? '0.00',
      })),
    };
  }

  async procurement(query: AdminDateRangeQueryDto) {
    const createdAt = this.range(query);
    const where: Prisma.PurchaseRequestWhereInput = {
      deletedAt: null,
      ...(createdAt ? { createdAt } : {}),
    };

    const byStatus = await this.prisma.purchaseRequest.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    return {
      total: byStatus.reduce((a, r) => a + r._count._all, 0),
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: r._count._all,
      })),
    };
  }

  async payments(query: AdminDateRangeQueryDto) {
    const createdAt = this.range(query);
    const where: Prisma.PaymentWhereInput = {
      ...(createdAt ? { createdAt } : {}),
    };

    const [byStatus, totals] = await Promise.all([
      this.prisma.payment.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where,
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      count: totals._count._all,
      totalAmount: totals._sum.amount?.toString() ?? '0.00',
      byStatus: byStatus.map((row) => ({
        status: row.status,
        count: row._count._all,
        totalAmount: row._sum.amount?.toString() ?? '0.00',
      })),
    };
  }

  async logistics(query: AdminDateRangeQueryDto) {
    const createdAt = this.range(query);
    const whereWithDelete = createdAt
      ? { createdAt, deletedAt: null as null }
      : { deletedAt: null as null };
    const deliveryWhere = createdAt ? { createdAt } : {};

    const [dispatches, shipments, deliveries] = await Promise.all([
      this.prisma.dispatch.groupBy({
        by: ['status'],
        where: whereWithDelete,
        _count: { _all: true },
      }),
      this.prisma.shipment.groupBy({
        by: ['status'],
        where: whereWithDelete,
        _count: { _all: true },
      }),
      this.prisma.delivery.groupBy({
        by: ['status'],
        where: deliveryWhere,
        _count: { _all: true },
      }),
    ]);

    return {
      dispatches: dispatches.map((r) => ({
        status: r.status,
        count: r._count._all,
      })),
      shipments: shipments.map((r) => ({
        status: r.status,
        count: r._count._all,
      })),
      deliveries: deliveries.map((r) => ({
        status: r.status,
        count: r._count._all,
      })),
    };
  }

  async sellers(query: AdminDateRangeQueryDto) {
    const createdAt = this.range(query);
    const where: Prisma.SellerProfileWhereInput = {
      deletedAt: null,
      ...(createdAt ? { createdAt } : {}),
    };
    const byStatus = await this.prisma.sellerProfile.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    return {
      total: byStatus.reduce((a, r) => a + r._count._all, 0),
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: r._count._all,
      })),
    };
  }

  async customers(query: AdminDateRangeQueryDto) {
    const createdAt = this.range(query);
    const where: Prisma.CustomerProfileWhereInput = {
      deletedAt: null,
      ...(createdAt ? { createdAt } : {}),
    };
    const byStatus = await this.prisma.customerProfile.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    return {
      total: byStatus.reduce((a, r) => a + r._count._all, 0),
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: r._count._all,
      })),
    };
  }

  async inventory(query: AdminDateRangeQueryDto) {
    // Inventory is a current snapshot — date range is ignored intentionally.
    void query;
    const [totals, byStatus, low, out] = await Promise.all([
      this.prisma.inventory.aggregate({
        where: { deletedAt: null },
        _sum: {
          availableQty: true,
          reservedQty: true,
          soldQty: true,
        },
        _count: { _all: true },
      }),
      this.prisma.inventory.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
        _sum: { availableQty: true, reservedQty: true },
      }),
      this.prisma.inventory.count({
        where: { deletedAt: null, status: InventoryStatus.LOW },
      }),
      this.prisma.inventory.count({
        where: { deletedAt: null, status: InventoryStatus.OUT_OF_STOCK },
      }),
    ]);

    return {
      totalProducts: totals._count._all,
      availableQuantity: totals._sum.availableQty?.toString() ?? '0.000',
      reservedQuantity: totals._sum.reservedQty?.toString() ?? '0.000',
      soldQuantity: totals._sum.soldQty?.toString() ?? '0.000',
      lowStockProducts: low,
      outOfStockProducts: out,
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: r._count._all,
        availableQuantity: r._sum.availableQty?.toString() ?? '0.000',
        reservedQuantity: r._sum.reservedQty?.toString() ?? '0.000',
      })),
    };
  }

  async settlements(query: AdminDateRangeQueryDto) {
    const createdAt = this.range(query);
    const where = createdAt ? { createdAt } : {};

    const [byStatus, totals] = await Promise.all([
      this.prisma.settlement.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: { netAmount: true, grossAmount: true },
      }),
      this.prisma.settlement.aggregate({
        where,
        _sum: { netAmount: true, grossAmount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      count: totals._count._all,
      netAmount: totals._sum.netAmount?.toString() ?? '0.00',
      grossAmount: totals._sum.grossAmount?.toString() ?? '0.00',
      byStatus: byStatus.map((row) => ({
        status: row.status,
        count: row._count._all,
        netAmount: row._sum.netAmount?.toString() ?? '0.00',
        grossAmount: row._sum.grossAmount?.toString() ?? '0.00',
      })),
      from: query.from ?? null,
      to: query.to ?? null,
    };
  }
}
