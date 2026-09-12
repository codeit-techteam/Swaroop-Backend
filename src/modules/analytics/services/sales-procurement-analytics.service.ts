import { Injectable } from '@nestjs/common';
import {
  Prisma,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { toDecimal } from '../../payments/common/money.util.js';
import { moneyStr, qtyStr, safeRate } from '../common/analytics-format.js';
import {
  buildPoWhere,
  buildPrWhere,
  periodMeta,
  resolveOrgIds,
} from '../common/analytics-filters.js';
import {
  GMV_PO_STATUSES,
  CANCELLED_PO_STATUSES,
  COMPLETED_PO_STATUSES,
} from '../common/gmv.constants.js';
import {
  resolveAnalyticsPeriod,
  resolveTrendGranularity,
} from '../common/analytics-period.js';
import type {
  AnalyticsQueryDto,
  AnalyticsTrendQueryDto,
  AnalyticsTopQueryDto,
} from '../dto/analytics-query.dto.js';

@Injectable()
export class SalesAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async sales(query: AnalyticsTrendQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const orgs = await resolveOrgIds(this.prisma, query);
    const baseWhere = buildPoWhere(period, orgs, query);
    const gmvWhere: Prisma.PurchaseOrderWhereInput = {
      ...baseWhere,
      status: { in: GMV_PO_STATUSES },
    };

    const [gmvAgg, completed, cancelled, pending, allInPeriod, trend] =
      await Promise.all([
        this.prisma.purchaseOrder.aggregate({
          where: gmvWhere,
          _sum: { totalAmount: true, orderedQuantity: true },
          _count: { _all: true },
        }),
        this.prisma.purchaseOrder.count({
          where: {
            ...baseWhere,
            status: { in: COMPLETED_PO_STATUSES },
          },
        }),
        this.prisma.purchaseOrder.count({
          where: {
            ...baseWhere,
            status: { in: CANCELLED_PO_STATUSES },
          },
        }),
        this.prisma.purchaseOrder.count({
          where: {
            ...baseWhere,
            status: {
              in: [
                PurchaseOrderStatus.DRAFT,
                PurchaseOrderStatus.SENT_TO_SELLER,
                PurchaseOrderStatus.SELLER_REVIEW,
                PurchaseOrderStatus.CONFIRMED,
                PurchaseOrderStatus.READY_FOR_DISPATCH,
                PurchaseOrderStatus.DISPATCHED,
                PurchaseOrderStatus.IN_TRANSIT,
              ],
            },
          },
        }),
        this.prisma.purchaseOrder.count({ where: baseWhere }),
        this.gmvTrend(period.from, period.to, query, orgs),
      ]);

    const orders = gmvAgg._count._all;
    const gmv = toDecimal(gmvAgg._sum.totalAmount);
    const quantity = toDecimal(gmvAgg._sum.orderedQuantity);
    const aov = orders > 0 ? gmv.div(orders) : toDecimal(0);

    return {
      summary: {
        gmv: moneyStr(gmv),
        orders,
        quantity: qtyStr(quantity),
        averageOrderValue: moneyStr(aov),
        completedOrders: completed,
        cancelledOrders: cancelled,
        pendingOrders: pending,
        totalOrdersInPeriod: allInPeriod,
      },
      trend,
      meta: periodMeta(period),
    };
  }

  async gmv(query: AnalyticsTrendQueryDto & AnalyticsTopQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const orgs = await resolveOrgIds(this.prisma, query);
    const topLimit = Math.min(Math.max(query.limit ?? 10, 1), 50);
    const granularity = resolveTrendGranularity(
      period.from,
      period.to,
      query.groupBy,
    );

    const gmvWhere = buildPoWhere(period, orgs, query, {
      status: { in: GMV_PO_STATUSES },
    });

    const [agg, trend, topSellers, topCustomers, topGrades, topProducts] =
      await Promise.all([
        this.prisma.purchaseOrder.aggregate({
          where: gmvWhere,
          _sum: { totalAmount: true, orderedQuantity: true },
          _count: { _all: true },
        }),
        this.gmvTrend(period.from, period.to, query, orgs, granularity),
        this.topBySeller(gmvWhere, topLimit),
        this.topByCustomer(gmvWhere, topLimit),
        this.topByGrade(period, orgs, query, topLimit),
        this.topByProduct(period, orgs, query, topLimit),
      ]);

    return {
      summary: {
        gmv: moneyStr(agg._sum.totalAmount),
        orderCount: agg._count._all,
        quantity: qtyStr(agg._sum.orderedQuantity),
        groupBy: granularity,
      },
      trend,
      topGradesByGMV: topGrades,
      topProductsByGMV: topProducts,
      topSellersByGMV: topSellers,
      topCustomersByGMV: topCustomers,
      meta: periodMeta(period),
    };
  }

  private async gmvTrend(
    from: Date,
    to: Date,
    query: AnalyticsTrendQueryDto,
    orgs: { sellerOrgId?: string; customerOrgId?: string },
    explicit?: 'day' | 'week' | 'month',
  ) {
    const unit = resolveTrendGranularity(from, to, explicit ?? query.groupBy);
    const periodExpr =
      unit === 'week'
        ? Prisma.sql`date_trunc('week', po.created_at)`
        : unit === 'month'
          ? Prisma.sql`date_trunc('month', po.created_at)`
          : Prisma.sql`date_trunc('day', po.created_at)`;
    const statusList = Prisma.join(
      GMV_PO_STATUSES.map((s) => Prisma.sql`${s}`),
    );

    const rows = await this.prisma.$queryRaw<
      Array<{ period: Date; gmv: Prisma.Decimal; orders: bigint }>
    >`
      SELECT ${periodExpr} AS period,
             COALESCE(SUM(po.total_amount), 0) AS gmv,
             COUNT(*)::bigint AS orders
      FROM purchase_orders po
      WHERE po.deleted_at IS NULL
        AND po.created_at >= ${from}
        AND po.created_at <= ${to}
        AND po.status::text IN (${statusList})
        ${orgs.sellerOrgId ? Prisma.sql`AND po.seller_org_id = ${orgs.sellerOrgId}::uuid` : Prisma.empty}
        ${orgs.customerOrgId ? Prisma.sql`AND po.customer_org_id = ${orgs.customerOrgId}::uuid` : Prisma.empty}
        ${query.paymentOption ? Prisma.sql`AND po.payment_method::text = ${query.paymentOption}` : Prisma.empty}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    return rows.map((r) => ({
      period: r.period.toISOString().slice(0, 10),
      gmv: moneyStr(r.gmv),
      orders: Number(r.orders),
    }));
  }

  private async topBySeller(
    where: Prisma.PurchaseOrderWhereInput,
    limit: number,
  ) {
    const grouped = await this.prisma.purchaseOrder.groupBy({
      by: ['sellerOrgId'],
      where,
      _sum: { totalAmount: true, orderedQuantity: true },
      _count: { _all: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: limit,
    });
    if (grouped.length === 0) return [];

    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: grouped.map((g) => g.sellerOrgId) } },
      select: {
        id: true,
        name: true,
        sellerProfile: { select: { id: true } },
      },
    });
    const orgMap = new Map(orgs.map((o) => [o.id, o]));

    return grouped.map((g) => {
      const org = orgMap.get(g.sellerOrgId);
      return {
        sellerId: org?.sellerProfile?.id ?? null,
        sellerOrgId: g.sellerOrgId,
        sellerName: org?.name ?? 'Unknown',
        gmv: moneyStr(g._sum.totalAmount),
        orders: g._count._all,
        quantity: qtyStr(g._sum.orderedQuantity),
      };
    });
  }

  private async topByCustomer(
    where: Prisma.PurchaseOrderWhereInput,
    limit: number,
  ) {
    const grouped = await this.prisma.purchaseOrder.groupBy({
      by: ['customerOrgId'],
      where,
      _sum: { totalAmount: true, orderedQuantity: true },
      _count: { _all: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: limit,
    });
    if (grouped.length === 0) return [];

    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: grouped.map((g) => g.customerOrgId) } },
      select: {
        id: true,
        name: true,
        customerProfile: { select: { id: true } },
      },
    });
    const orgMap = new Map(orgs.map((o) => [o.id, o]));

    return grouped.map((g) => {
      const org = orgMap.get(g.customerOrgId);
      return {
        customerId: org?.customerProfile?.id ?? null,
        customerOrgId: g.customerOrgId,
        customerName: org?.name ?? 'Unknown',
        gmv: moneyStr(g._sum.totalAmount),
        orders: g._count._all,
        quantity: qtyStr(g._sum.orderedQuantity),
      };
    });
  }

  private async topByGrade(
    period: ReturnType<typeof resolveAnalyticsPeriod>,
    orgs: { sellerOrgId?: string; customerOrgId?: string },
    query: AnalyticsQueryDto,
    limit: number,
  ) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        grade_id: string;
        code: string;
        name: string;
        gmv: Prisma.Decimal;
        orders: bigint;
        quantity: Prisma.Decimal;
      }>
    >`
      SELECT g.id AS grade_id, g.code, g.name,
             COALESCE(SUM(po.total_amount), 0) AS gmv,
             COUNT(DISTINCT po.id)::bigint AS orders,
             COALESCE(SUM(pri.quantity), 0) AS quantity
      FROM purchase_orders po
      INNER JOIN purchase_requests pr ON pr.id = po.purchase_request_id AND pr.deleted_at IS NULL
      INNER JOIN purchase_request_items pri ON pri.purchase_request_id = pr.id
      INNER JOIN grades g ON g.id = pri.grade_id
      WHERE po.deleted_at IS NULL
        AND po.created_at >= ${period.from}
        AND po.created_at <= ${period.to}
        AND po.status::text IN (${Prisma.join(GMV_PO_STATUSES)})
        ${orgs.sellerOrgId ? Prisma.sql`AND po.seller_org_id = ${orgs.sellerOrgId}::uuid` : Prisma.empty}
        ${orgs.customerOrgId ? Prisma.sql`AND po.customer_org_id = ${orgs.customerOrgId}::uuid` : Prisma.empty}
        ${query.gradeId ? Prisma.sql`AND g.id = ${query.gradeId}::uuid` : Prisma.empty}
      GROUP BY g.id, g.code, g.name
      ORDER BY gmv DESC
      LIMIT ${limit}
    `;

    return rows.map((r) => ({
      gradeId: r.grade_id,
      code: r.code,
      name: r.name,
      gmv: moneyStr(r.gmv),
      orders: Number(r.orders),
      quantity: qtyStr(r.quantity),
    }));
  }

  private async topByProduct(
    period: ReturnType<typeof resolveAnalyticsPeriod>,
    orgs: { sellerOrgId?: string; customerOrgId?: string },
    query: AnalyticsQueryDto,
    limit: number,
  ) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        product_id: string;
        name: string;
        grade_id: string;
        gmv: Prisma.Decimal;
        orders: bigint;
        quantity: Prisma.Decimal;
      }>
    >`
      SELECT p.id AS product_id, p.name, p.grade_id,
             COALESCE(SUM(po.total_amount), 0) AS gmv,
             COUNT(DISTINCT po.id)::bigint AS orders,
             COALESCE(SUM(pri.quantity), 0) AS quantity
      FROM purchase_orders po
      INNER JOIN purchase_requests pr ON pr.id = po.purchase_request_id AND pr.deleted_at IS NULL
      INNER JOIN purchase_request_items pri ON pri.purchase_request_id = pr.id AND pri.product_id IS NOT NULL
      INNER JOIN products p ON p.id = pri.product_id
      WHERE po.deleted_at IS NULL
        AND po.created_at >= ${period.from}
        AND po.created_at <= ${period.to}
        AND po.status::text IN (${Prisma.join(GMV_PO_STATUSES)})
        ${orgs.sellerOrgId ? Prisma.sql`AND po.seller_org_id = ${orgs.sellerOrgId}::uuid` : Prisma.empty}
        ${orgs.customerOrgId ? Prisma.sql`AND po.customer_org_id = ${orgs.customerOrgId}::uuid` : Prisma.empty}
        ${query.productId ? Prisma.sql`AND p.id = ${query.productId}::uuid` : Prisma.empty}
      GROUP BY p.id, p.name, p.grade_id
      ORDER BY gmv DESC
      LIMIT ${limit}
    `;

    return rows.map((r) => ({
      productId: r.product_id,
      name: r.name,
      gradeId: r.grade_id,
      gmv: moneyStr(r.gmv),
      orders: Number(r.orders),
      quantity: qtyStr(r.quantity),
    }));
  }
}

@Injectable()
export class ProcurementAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async procurement(query: AnalyticsQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const orgs = await resolveOrgIds(this.prisma, query);
    const prWhere = buildPrWhere(period, orgs, query);
    const poWhere = buildPoWhere(period, orgs, query);

    const [prByStatus, counterOffers, commerciallyAccepted, poByStatus] =
      await Promise.all([
        this.prisma.purchaseRequest.groupBy({
          by: ['status'],
          where: prWhere,
          _count: { _all: true },
        }),
        this.prisma.counterOffer.count({
          where: {
            createdAt: { gte: period.from, lte: period.to },
            purchaseRequest: prWhere,
          },
        }),
        this.prisma.purchaseRequest.count({
          where: {
            ...prWhere,
            commerciallyAcceptedAt: { not: null },
          },
        }),
        this.prisma.purchaseOrder.groupBy({
          by: ['status'],
          where: poWhere,
          _count: { _all: true },
        }),
      ]);

    const statusCount = (
      rows: { status: string; _count: { _all: number } }[],
    ) => Object.fromEntries(rows.map((r) => [r.status, r._count._all]));

    const prMap = statusCount(prByStatus);

    const prTotal = prByStatus.reduce((a, r) => a + r._count._all, 0);
    const poTotal = poByStatus.reduce((a, r) => a + r._count._all, 0);
    const accepted =
      (prMap[PurchaseRequestStatus.APPROVED] ?? 0) +
      (prMap[PurchaseRequestStatus.CONVERTED_TO_ORDER] ?? 0);
    const rejected = prMap[PurchaseRequestStatus.REJECTED] ?? 0;
    const expired = prMap[PurchaseRequestStatus.EXPIRED] ?? 0;
    const negotiation = prMap[PurchaseRequestStatus.NEGOTIATION] ?? 0;

    const poActive = poByStatus
      .filter(
        (r) =>
          !CANCELLED_PO_STATUSES.includes(r.status) &&
          r.status !== PurchaseOrderStatus.COMPLETED,
      )
      .reduce((a, r) => a + r._count._all, 0);
    const poCompleted = poByStatus
      .filter((r) => COMPLETED_PO_STATUSES.includes(r.status))
      .reduce((a, r) => a + r._count._all, 0);
    const poCancelled = poByStatus
      .filter((r) => CANCELLED_PO_STATUSES.includes(r.status))
      .reduce((a, r) => a + r._count._all, 0);

    return {
      purchaseRequests: {
        total: prTotal,
        accepted,
        rejected,
        expired,
        counterOffered: negotiation,
        counterOfferRecords: counterOffers,
        commerciallyAccepted,
        byStatus: prByStatus.map((r) => ({
          status: r.status,
          count: r._count._all,
        })),
      },
      purchaseOrders: {
        total: poTotal,
        active: poActive,
        completed: poCompleted,
        cancelled: poCancelled,
        byStatus: poByStatus.map((r) => ({
          status: r.status,
          count: r._count._all,
        })),
      },
      conversion: {
        prToPoRate: safeRate(poTotal, prTotal, true),
      },
      meta: periodMeta(period),
    };
  }

  async purchaseRequests(query: AnalyticsQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const orgs = await resolveOrgIds(this.prisma, query);
    const prWhere = buildPrWhere(period, orgs, query);

    const [
      total,
      responded,
      accepted,
      rejected,
      expired,
      counterOffered,
      commercial,
      avgResponse,
    ] = await Promise.all([
      this.prisma.purchaseRequest.count({ where: prWhere }),
      this.prisma.purchaseRequest.count({
        where: { ...prWhere, sellerRespondedAt: { not: null } },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          ...prWhere,
          status: {
            in: [
              PurchaseRequestStatus.APPROVED,
              PurchaseRequestStatus.CONVERTED_TO_ORDER,
            ],
          },
        },
      }),
      this.prisma.purchaseRequest.count({
        where: { ...prWhere, status: PurchaseRequestStatus.REJECTED },
      }),
      this.prisma.purchaseRequest.count({
        where: { ...prWhere, status: PurchaseRequestStatus.EXPIRED },
      }),
      this.prisma.purchaseRequest.count({
        where: { ...prWhere, status: PurchaseRequestStatus.NEGOTIATION },
      }),
      this.prisma.purchaseRequest.count({
        where: { ...prWhere, commerciallyAcceptedAt: { not: null } },
      }),
      this.prisma.$queryRaw<Array<{ avg_seconds: number | null }>>`
          SELECT AVG(EXTRACT(EPOCH FROM (seller_responded_at - COALESCE(submitted_at, created_at)))) AS avg_seconds
          FROM purchase_requests
          WHERE deleted_at IS NULL
            AND created_at >= ${period.from}
            AND created_at <= ${period.to}
            AND seller_responded_at IS NOT NULL
            ${orgs.sellerOrgId ? Prisma.sql`AND seller_org_id = ${orgs.sellerOrgId}::uuid` : Prisma.empty}
            ${orgs.customerOrgId ? Prisma.sql`AND customer_org_id = ${orgs.customerOrgId}::uuid` : Prisma.empty}
        `,
    ]);

    const avgSec = avgResponse[0]?.avg_seconds;
    return {
      total,
      sellerResponseCount: responded,
      sellerAccepted: accepted,
      sellerRejected: rejected,
      counterOffered,
      expired,
      commerciallyAccepted: commercial,
      sellerResponseRate: safeRate(responded, total, true),
      acceptanceRate: safeRate(accepted, total, true),
      counterOfferRate: safeRate(counterOffered, total, true),
      expirationRate: safeRate(expired, total, true),
      averageSellerResponseSeconds:
        avgSec != null && Number.isFinite(Number(avgSec))
          ? Math.round(Number(avgSec))
          : null,
      meta: periodMeta(period),
    };
  }

  async purchaseOrders(query: AnalyticsQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const orgs = await resolveOrgIds(this.prisma, query);
    const poWhere = buildPoWhere(period, orgs, query);

    const [byStatus, totals, byPayment, bySeller, byCustomer] =
      await Promise.all([
        this.prisma.purchaseOrder.groupBy({
          by: ['status'],
          where: poWhere,
          _count: { _all: true },
          _sum: { totalAmount: true, orderedQuantity: true },
        }),
        this.prisma.purchaseOrder.aggregate({
          where: poWhere,
          _sum: { totalAmount: true, orderedQuantity: true },
          _count: { _all: true },
        }),
        this.prisma.purchaseOrder.groupBy({
          by: ['paymentMethod'],
          where: poWhere,
          _count: { _all: true },
          _sum: { totalAmount: true },
        }),
        this.prisma.purchaseOrder.groupBy({
          by: ['sellerOrgId'],
          where: poWhere,
          _count: { _all: true },
          _sum: { totalAmount: true },
          orderBy: { _sum: { totalAmount: 'desc' } },
          take: 20,
        }),
        this.prisma.purchaseOrder.groupBy({
          by: ['customerOrgId'],
          where: poWhere,
          _count: { _all: true },
          _sum: { totalAmount: true },
          orderBy: { _sum: { totalAmount: 'desc' } },
          take: 20,
        }),
      ]);

    const total = totals._count._all;
    const totalValue = toDecimal(totals._sum.totalAmount);
    const active = byStatus
      .filter(
        (r) =>
          !CANCELLED_PO_STATUSES.includes(r.status) &&
          r.status !== PurchaseOrderStatus.COMPLETED,
      )
      .reduce((a, r) => a + r._count._all, 0);
    const completed = byStatus
      .filter((r) => COMPLETED_PO_STATUSES.includes(r.status))
      .reduce((a, r) => a + r._count._all, 0);
    const cancelled = byStatus
      .filter((r) => CANCELLED_PO_STATUSES.includes(r.status))
      .reduce((a, r) => a + r._count._all, 0);

    return {
      total,
      active,
      completed,
      cancelled,
      totalPoValue: moneyStr(totalValue),
      averagePoValue: moneyStr(total > 0 ? totalValue.div(total) : 0),
      totalQuantity: qtyStr(totals._sum.orderedQuantity),
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: r._count._all,
        totalAmount: moneyStr(r._sum.totalAmount),
        quantity: qtyStr(r._sum.orderedQuantity),
      })),
      byPaymentOption: byPayment.map((r) => ({
        paymentOption: r.paymentMethod,
        count: r._count._all,
        totalAmount: moneyStr(r._sum.totalAmount),
      })),
      bySeller: bySeller.map((r) => ({
        sellerOrgId: r.sellerOrgId,
        count: r._count._all,
        totalAmount: moneyStr(r._sum.totalAmount),
      })),
      byCustomer: byCustomer.map((r) => ({
        customerOrgId: r.customerOrgId,
        count: r._count._all,
        totalAmount: moneyStr(r._sum.totalAmount),
      })),
      meta: periodMeta(period),
    };
  }
}
