import { Injectable } from '@nestjs/common';
import {
  DeliveryStatus,
  DispatchStatus,
  InventoryStatus,
  PaymentScheduleType,
  PaymentStatus,
  Prisma,
  SettlementStatus,
  SellerStatus,
  CustomerStatus,
  ShipmentStatus,
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
import { GMV_PO_STATUSES } from '../common/gmv.constants.js';
import { resolveAnalyticsPeriod } from '../common/analytics-period.js';
import type { AnalyticsQueryDto } from '../dto/analytics-query.dto.js';

const VERIFIED_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.VERIFIED,
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_PAID,
];

const PENDING_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.INITIATED,
  PaymentStatus.PENDING,
  PaymentStatus.AUTHORIZED,
  PaymentStatus.SUBMITTED,
  PaymentStatus.UNDER_VERIFICATION,
  PaymentStatus.OVERDUE,
];

@Injectable()
export class PaymentAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async payments(query: AnalyticsQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const orgs = await resolveOrgIds(this.prisma, query);

    const where: Prisma.PaymentWhereInput = {
      createdAt: { gte: period.from, lte: period.to },
      ...(orgs.customerOrgId ? { organizationId: orgs.customerOrgId } : {}),
      ...(orgs.sellerOrgId ? { sellerOrgId: orgs.sellerOrgId } : {}),
      ...(query.paymentOption ? { method: query.paymentOption } : {}),
      ...(query.status ? { status: query.status as PaymentStatus } : {}),
    };

    const [byStatus, totals, byMethod, trend] = await Promise.all([
      this.prisma.payment.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: { amount: true, paidAmount: true, pendingAmount: true },
      }),
      this.prisma.payment.aggregate({
        where,
        _sum: { amount: true, paidAmount: true, pendingAmount: true },
        _count: { _all: true },
      }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.$queryRaw<
        Array<{ period: Date; amount: Prisma.Decimal; count: bigint }>
      >`
        SELECT date_trunc('day', created_at) AS period,
               COALESCE(SUM(amount), 0) AS amount,
               COUNT(*)::bigint AS count
        FROM payments
        WHERE created_at >= ${period.from}
          AND created_at <= ${period.to}
          ${orgs.customerOrgId ? Prisma.sql`AND organization_id = ${orgs.customerOrgId}::uuid` : Prisma.empty}
          ${orgs.sellerOrgId ? Prisma.sql`AND seller_org_id = ${orgs.sellerOrgId}::uuid` : Prisma.empty}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
    ]);

    const statusMap = Object.fromEntries(
      byStatus.map((r) => [r.status, r]),
    ) as Record<
      string,
      {
        _count: { _all: number };
        _sum: {
          amount: Prisma.Decimal | null;
          paidAmount: Prisma.Decimal | null;
          pendingAmount: Prisma.Decimal | null;
        };
      }
    >;

    const sumStatuses = (statuses: PaymentStatus[]) =>
      statuses.reduce(
        (acc, s) => acc.plus(toDecimal(statusMap[s]?._sum?.amount)),
        toDecimal(0),
      );

    const countStatuses = (statuses: PaymentStatus[]) =>
      statuses.reduce((acc, s) => acc + (statusMap[s]?._count._all ?? 0), 0);

    return {
      totalPaymentAmount: moneyStr(totals._sum.amount),
      verifiedAmount: moneyStr(sumStatuses(VERIFIED_PAYMENT_STATUSES)),
      pendingAmount: moneyStr(sumStatuses(PENDING_PAYMENT_STATUSES)),
      underVerificationAmount: moneyStr(
        statusMap[PaymentStatus.UNDER_VERIFICATION]?._sum.amount,
      ),
      rejectedAmount: moneyStr(statusMap[PaymentStatus.REJECTED]?._sum.amount),
      refundedAmount: moneyStr(statusMap[PaymentStatus.REFUNDED]?._sum.amount),
      partiallyRefundedAmount: moneyStr(
        statusMap[PaymentStatus.PARTIALLY_REFUNDED]?._sum.amount,
      ),
      counts: {
        initiated: statusMap[PaymentStatus.INITIATED]?._count._all ?? 0,
        pending: statusMap[PaymentStatus.PENDING]?._count._all ?? 0,
        submitted: statusMap[PaymentStatus.SUBMITTED]?._count._all ?? 0,
        underVerification:
          statusMap[PaymentStatus.UNDER_VERIFICATION]?._count._all ?? 0,
        verified: countStatuses(VERIFIED_PAYMENT_STATUSES),
        failed: statusMap[PaymentStatus.FAILED]?._count._all ?? 0,
        rejected: statusMap[PaymentStatus.REJECTED]?._count._all ?? 0,
        cancelled: statusMap[PaymentStatus.CANCELLED]?._count._all ?? 0,
        refunded: statusMap[PaymentStatus.REFUNDED]?._count._all ?? 0,
        total: totals._count._all,
      },
      byMethod: byMethod.map((r) => ({
        method: r.method,
        count: r._count._all,
        amount: moneyStr(r._sum.amount),
      })),
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: r._count._all,
        amount: moneyStr(r._sum.amount),
        paidAmount: moneyStr(r._sum.paidAmount),
        pendingAmount: moneyStr(r._sum.pendingAmount),
      })),
      trend: trend.map((r) => ({
        period: r.period.toISOString().slice(0, 10),
        amount: moneyStr(r.amount),
        count: Number(r.count),
      })),
      meta: periodMeta(period),
    };
  }

  /**
   * Payment clearance for dispatch — mirrors PaymentScheduleService rules in SQL
   * (ADVANCE / BEFORE_DISPATCH / metadata.dispatchBlocking with remaining > 0).
   */
  async paymentClearance(query: AnalyticsQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const orgs = await resolveOrgIds(this.prisma, query);
    const poWhere = buildPoWhere(period, orgs, query);

    const total = await this.prisma.purchaseOrder.count({ where: poWhere });

    const blockedRows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM purchase_orders po
      WHERE po.deleted_at IS NULL
        AND po.created_at >= ${period.from}
        AND po.created_at <= ${period.to}
        ${orgs.sellerOrgId ? Prisma.sql`AND po.seller_org_id = ${orgs.sellerOrgId}::uuid` : Prisma.empty}
        ${orgs.customerOrgId ? Prisma.sql`AND po.customer_org_id = ${orgs.customerOrgId}::uuid` : Prisma.empty}
        AND EXISTS (
          SELECT 1 FROM payment_schedules ps
          WHERE ps.purchase_order_id = po.id
            AND ps.remaining_amount > 0
            AND (
              ps.type::text IN (${PaymentScheduleType.ADVANCE}, ${PaymentScheduleType.BEFORE_DISPATCH})
              OR COALESCE((ps.metadata->>'dispatchBlocking')::boolean, false) = true
            )
        )
    `;

    const blocked = Number(blockedRows[0]?.count ?? 0);

    const partiallyPaid = await this.prisma.purchaseOrder.count({
      where: {
        ...poWhere,
        payments: {
          some: { status: PaymentStatus.PARTIALLY_PAID },
        },
      },
    });

    const verifiedPaid = await this.prisma.purchaseOrder.count({
      where: {
        ...poWhere,
        payments: {
          some: {
            status: { in: [PaymentStatus.VERIFIED, PaymentStatus.PAID] },
          },
        },
      },
    });

    return {
      paymentCleared: Math.max(0, total - blocked),
      paymentPending: blocked,
      paymentPartiallyPaid: partiallyPaid,
      paymentBlockedForDispatch: blocked,
      paymentVerifiedOrPaid: verifiedPaid,
      totalPurchaseOrders: total,
      meta: periodMeta(period),
    };
  }
}

@Injectable()
export class PartyAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async sellers(query: AnalyticsQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const orgs = await resolveOrgIds(this.prisma, query);
    const limit = 50;

    const rows = await this.prisma.$queryRaw<
      Array<{
        seller_org_id: string;
        seller_id: string | null;
        seller_name: string;
        orders: bigint;
        gmv: Prisma.Decimal;
        quantity: Prisma.Decimal;
        accepted_pr: bigint;
        rejected_pr: bigint;
        counter_offers: bigint;
        active_offers: bigint;
        completed_orders: bigint;
        cancelled_orders: bigint;
        shipment_count: bigint;
        delivered_shipment_count: bigint;
      }>
    >`
      SELECT
        po.seller_org_id,
        sp.id AS seller_id,
        COALESCE(o.name, 'Unknown') AS seller_name,
        COUNT(DISTINCT po.id)::bigint AS orders,
        COALESCE(SUM(CASE WHEN po.status::text IN (${Prisma.join(GMV_PO_STATUSES.map((s) => Prisma.sql`${s}`))}) THEN po.total_amount ELSE 0 END), 0) AS gmv,
        COALESCE(SUM(po.ordered_quantity), 0) AS quantity,
        (SELECT COUNT(*) FROM purchase_requests pr
          WHERE pr.seller_org_id = po.seller_org_id AND pr.deleted_at IS NULL
            AND pr.created_at >= ${period.from} AND pr.created_at <= ${period.to}
            AND pr.status::text IN ('APPROVED','CONVERTED_TO_ORDER'))::bigint AS accepted_pr,
        (SELECT COUNT(*) FROM purchase_requests pr
          WHERE pr.seller_org_id = po.seller_org_id AND pr.deleted_at IS NULL
            AND pr.created_at >= ${period.from} AND pr.created_at <= ${period.to}
            AND pr.status::text = 'REJECTED')::bigint AS rejected_pr,
        (SELECT COUNT(*) FROM counter_offers co
          JOIN purchase_requests pr ON pr.id = co.purchase_request_id
          WHERE pr.seller_org_id = po.seller_org_id
            AND co.created_at >= ${period.from} AND co.created_at <= ${period.to})::bigint AS counter_offers,
        (SELECT COUNT(*) FROM offers ofr
          WHERE ofr.organization_id = po.seller_org_id AND ofr.deleted_at IS NULL
            AND ofr.status::text = 'ACTIVE')::bigint AS active_offers,
        COUNT(DISTINCT CASE WHEN po.status::text IN ('COMPLETED','DELIVERED') THEN po.id END)::bigint AS completed_orders,
        COUNT(DISTINCT CASE WHEN po.status::text IN ('CANCELLED','REJECTED') THEN po.id END)::bigint AS cancelled_orders,
        (SELECT COUNT(*) FROM shipments s
          WHERE s.seller_org_id = po.seller_org_id AND s.deleted_at IS NULL
            AND s.created_at >= ${period.from} AND s.created_at <= ${period.to})::bigint AS shipment_count,
        (SELECT COUNT(*) FROM shipments s
          WHERE s.seller_org_id = po.seller_org_id AND s.deleted_at IS NULL
            AND s.created_at >= ${period.from} AND s.created_at <= ${period.to}
            AND s.status::text IN ('DELIVERED','DELIVERY_CONFIRMED'))::bigint AS delivered_shipment_count
      FROM purchase_orders po
      LEFT JOIN organizations o ON o.id = po.seller_org_id
      LEFT JOIN seller_profiles sp ON sp.organization_id = po.seller_org_id AND sp.deleted_at IS NULL
      WHERE po.deleted_at IS NULL
        AND po.created_at >= ${period.from}
        AND po.created_at <= ${period.to}
        ${orgs.sellerOrgId ? Prisma.sql`AND po.seller_org_id = ${orgs.sellerOrgId}::uuid` : Prisma.empty}
      GROUP BY po.seller_org_id, sp.id, o.name
      ORDER BY gmv DESC
      LIMIT ${limit}
    `;

    const items = rows.map((r) => {
      const orders = Number(r.orders);
      const completed = Number(r.completed_orders);
      const accepted = Number(r.accepted_pr);
      const rejected = Number(r.rejected_pr);
      const shipments = Number(r.shipment_count);
      const delivered = Number(r.delivered_shipment_count);
      return {
        sellerId: r.seller_id,
        sellerOrgId: r.seller_org_id,
        sellerName: r.seller_name,
        orders,
        gmv: moneyStr(r.gmv),
        quantity: qtyStr(r.quantity),
        acceptedPR: accepted,
        rejectedPR: rejected,
        counterOffers: Number(r.counter_offers),
        activeOffers: Number(r.active_offers),
        completedOrders: completed,
        cancelledOrders: Number(r.cancelled_orders),
        shipmentCount: shipments,
        deliveredShipmentCount: delivered,
        acceptanceRate: safeRate(accepted, accepted + rejected, true),
        completionRate: safeRate(completed, orders, true),
        deliverySuccessRate: safeRate(delivered, shipments, true),
      };
    });

    return {
      items,
      topByGmv: [...items]
        .sort((a, b) => toDecimal(b.gmv).comparedTo(toDecimal(a.gmv)))
        .slice(0, 10),
      topByOrderVolume: [...items]
        .sort((a, b) => b.orders - a.orders)
        .slice(0, 10),
      topByQuantity: [...items]
        .sort((a, b) => toDecimal(b.quantity).comparedTo(toDecimal(a.quantity)))
        .slice(0, 10),
      meta: periodMeta(period),
    };
  }

  async customers(query: AnalyticsQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const orgs = await resolveOrgIds(this.prisma, query);
    const limit = 50;

    const rows = await this.prisma.$queryRaw<
      Array<{
        customer_org_id: string;
        customer_id: string | null;
        customer_name: string;
        orders: bigint;
        gmv: Prisma.Decimal;
        quantity: Prisma.Decimal;
        purchase_requests: bigint;
        accepted_pr: bigint;
        completed_orders: bigint;
        cancelled_orders: bigint;
        payments: bigint;
        pending_payments: bigint;
      }>
    >`
      SELECT
        po.customer_org_id,
        cp.id AS customer_id,
        COALESCE(o.name, 'Unknown') AS customer_name,
        COUNT(DISTINCT po.id)::bigint AS orders,
        COALESCE(SUM(CASE WHEN po.status::text IN (${Prisma.join(GMV_PO_STATUSES.map((s) => Prisma.sql`${s}`))}) THEN po.total_amount ELSE 0 END), 0) AS gmv,
        COALESCE(SUM(po.ordered_quantity), 0) AS quantity,
        (SELECT COUNT(*) FROM purchase_requests pr
          WHERE pr.customer_org_id = po.customer_org_id AND pr.deleted_at IS NULL
            AND pr.created_at >= ${period.from} AND pr.created_at <= ${period.to})::bigint AS purchase_requests,
        (SELECT COUNT(*) FROM purchase_requests pr
          WHERE pr.customer_org_id = po.customer_org_id AND pr.deleted_at IS NULL
            AND pr.created_at >= ${period.from} AND pr.created_at <= ${period.to}
            AND pr.status::text IN ('APPROVED','CONVERTED_TO_ORDER'))::bigint AS accepted_pr,
        COUNT(DISTINCT CASE WHEN po.status::text IN ('COMPLETED','DELIVERED') THEN po.id END)::bigint AS completed_orders,
        COUNT(DISTINCT CASE WHEN po.status::text IN ('CANCELLED','REJECTED') THEN po.id END)::bigint AS cancelled_orders,
        (SELECT COUNT(*) FROM payments p
          WHERE p.organization_id = po.customer_org_id
            AND p.created_at >= ${period.from} AND p.created_at <= ${period.to})::bigint AS payments,
        (SELECT COUNT(*) FROM payments p
          WHERE p.organization_id = po.customer_org_id
            AND p.created_at >= ${period.from} AND p.created_at <= ${period.to}
            AND p.status::text IN (${Prisma.join(PENDING_PAYMENT_STATUSES.map((s) => Prisma.sql`${s}`))}))::bigint AS pending_payments
      FROM purchase_orders po
      LEFT JOIN organizations o ON o.id = po.customer_org_id
      LEFT JOIN customer_profiles cp ON cp.organization_id = po.customer_org_id AND cp.deleted_at IS NULL
      WHERE po.deleted_at IS NULL
        AND po.created_at >= ${period.from}
        AND po.created_at <= ${period.to}
        ${orgs.customerOrgId ? Prisma.sql`AND po.customer_org_id = ${orgs.customerOrgId}::uuid` : Prisma.empty}
      GROUP BY po.customer_org_id, cp.id, o.name
      ORDER BY gmv DESC
      LIMIT ${limit}
    `;

    const items = rows.map((r) => ({
      customerId: r.customer_id,
      customerOrgId: r.customer_org_id,
      customerName: r.customer_name,
      orders: Number(r.orders),
      gmv: moneyStr(r.gmv),
      quantity: qtyStr(r.quantity),
      purchaseRequests: Number(r.purchase_requests),
      acceptedPR: Number(r.accepted_pr),
      completedOrders: Number(r.completed_orders),
      cancelledOrders: Number(r.cancelled_orders),
      payments: Number(r.payments),
      pendingPayments: Number(r.pending_payments),
    }));

    return {
      items,
      topByGmv: [...items]
        .sort((a, b) => toDecimal(b.gmv).comparedTo(toDecimal(a.gmv)))
        .slice(0, 10),
      topByOrderVolume: [...items]
        .sort((a, b) => b.orders - a.orders)
        .slice(0, 10),
      topByQuantity: [...items]
        .sort((a, b) => toDecimal(b.quantity).comparedTo(toDecimal(a.quantity)))
        .slice(0, 10),
      meta: periodMeta(period),
    };
  }
}

@Injectable()
export class CatalogInventoryAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async grades(query: AnalyticsQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const rows = await this.prisma.$queryRaw<
      Array<{
        grade_id: string;
        code: string;
        name: string;
        products: bigint;
        offers: bigint;
        purchase_requests: bigint;
        orders: bigint;
        quantity: Prisma.Decimal;
        gmv: Prisma.Decimal;
      }>
    >`
      SELECT g.id AS grade_id, g.code, g.name,
             (SELECT COUNT(*) FROM products p WHERE p.grade_id = g.id AND p.deleted_at IS NULL)::bigint AS products,
             (SELECT COUNT(*) FROM offers ofr
               JOIN products p ON p.id = ofr.product_id
               WHERE p.grade_id = g.id AND ofr.deleted_at IS NULL)::bigint AS offers,
             (SELECT COUNT(DISTINCT pri.purchase_request_id) FROM purchase_request_items pri
               JOIN purchase_requests pr ON pr.id = pri.purchase_request_id
               WHERE pri.grade_id = g.id AND pr.deleted_at IS NULL
                 AND pr.created_at >= ${period.from} AND pr.created_at <= ${period.to})::bigint AS purchase_requests,
             COUNT(DISTINCT po.id)::bigint AS orders,
             COALESCE(SUM(pri.quantity), 0) AS quantity,
             COALESCE(SUM(CASE WHEN po.status::text IN (${Prisma.join(GMV_PO_STATUSES.map((s) => Prisma.sql`${s}`))}) THEN po.total_amount ELSE 0 END), 0) AS gmv
      FROM grades g
      LEFT JOIN purchase_request_items pri ON pri.grade_id = g.id
      LEFT JOIN purchase_requests pr ON pr.id = pri.purchase_request_id AND pr.deleted_at IS NULL
        AND pr.created_at >= ${period.from} AND pr.created_at <= ${period.to}
      LEFT JOIN purchase_orders po ON po.purchase_request_id = pr.id AND po.deleted_at IS NULL
      WHERE g.deleted_at IS NULL
        ${query.gradeId ? Prisma.sql`AND g.id = ${query.gradeId}::uuid` : Prisma.empty}
      GROUP BY g.id, g.code, g.name
      ORDER BY gmv DESC
      LIMIT 100
    `;

    const items = rows.map((r) => ({
      gradeId: r.grade_id,
      code: r.code,
      name: r.name,
      products: Number(r.products),
      offers: Number(r.offers),
      purchaseRequests: Number(r.purchase_requests),
      orders: Number(r.orders),
      quantity: qtyStr(r.quantity),
      gmv: moneyStr(r.gmv),
    }));

    return {
      items,
      topByGmv: [...items]
        .sort((a, b) => toDecimal(b.gmv).comparedTo(toDecimal(a.gmv)))
        .slice(0, 10),
      topByQuantity: [...items]
        .sort((a, b) => toDecimal(b.quantity).comparedTo(toDecimal(a.quantity)))
        .slice(0, 10),
      topByOrderVolume: [...items]
        .sort((a, b) => b.orders - a.orders)
        .slice(0, 10),
      meta: periodMeta(period),
    };
  }

  async products(query: AnalyticsQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const rows = await this.prisma.$queryRaw<
      Array<{
        product_id: string;
        name: string;
        grade_id: string;
        seller_count: bigint;
        offer_count: bigint;
        pr_count: bigint;
        order_count: bigint;
        quantity: Prisma.Decimal;
        gmv: Prisma.Decimal;
      }>
    >`
      SELECT p.id AS product_id, p.name, p.grade_id,
             COUNT(DISTINCT p.organization_id)::bigint AS seller_count,
             (SELECT COUNT(*) FROM offers ofr WHERE ofr.product_id = p.id AND ofr.deleted_at IS NULL)::bigint AS offer_count,
             (SELECT COUNT(DISTINCT pri.purchase_request_id) FROM purchase_request_items pri
               JOIN purchase_requests pr ON pr.id = pri.purchase_request_id
               WHERE pri.product_id = p.id AND pr.deleted_at IS NULL
                 AND pr.created_at >= ${period.from} AND pr.created_at <= ${period.to})::bigint AS pr_count,
             COUNT(DISTINCT po.id)::bigint AS order_count,
             COALESCE(SUM(pri.quantity), 0) AS quantity,
             COALESCE(SUM(CASE WHEN po.status::text IN (${Prisma.join(GMV_PO_STATUSES.map((s) => Prisma.sql`${s}`))}) THEN po.total_amount ELSE 0 END), 0) AS gmv
      FROM products p
      LEFT JOIN purchase_request_items pri ON pri.product_id = p.id
      LEFT JOIN purchase_requests pr ON pr.id = pri.purchase_request_id AND pr.deleted_at IS NULL
        AND pr.created_at >= ${period.from} AND pr.created_at <= ${period.to}
      LEFT JOIN purchase_orders po ON po.purchase_request_id = pr.id AND po.deleted_at IS NULL
      WHERE p.deleted_at IS NULL
        ${query.productId ? Prisma.sql`AND p.id = ${query.productId}::uuid` : Prisma.empty}
        ${query.gradeId ? Prisma.sql`AND p.grade_id = ${query.gradeId}::uuid` : Prisma.empty}
      GROUP BY p.id, p.name, p.grade_id
      ORDER BY gmv DESC
      LIMIT 100
    `;

    const items = rows.map((r) => ({
      productId: r.product_id,
      name: r.name,
      gradeId: r.grade_id,
      sellerCount: Number(r.seller_count),
      offerCount: Number(r.offer_count),
      purchaseRequestCount: Number(r.pr_count),
      orderCount: Number(r.order_count),
      quantity: qtyStr(r.quantity),
      gmv: moneyStr(r.gmv),
    }));

    return {
      items,
      topByGmv: [...items]
        .sort((a, b) => toDecimal(b.gmv).comparedTo(toDecimal(a.gmv)))
        .slice(0, 10),
      topByQuantity: [...items]
        .sort((a, b) => toDecimal(b.quantity).comparedTo(toDecimal(a.quantity)))
        .slice(0, 10),
      topByOrderVolume: [...items]
        .sort((a, b) => b.orderCount - a.orderCount)
        .slice(0, 10),
      meta: periodMeta(period),
    };
  }

  async inventory(query: AnalyticsQueryDto) {
    const where: Prisma.InventoryWhereInput = {
      deletedAt: null,
      ...(query.sellerId ? { sellerProfileId: query.sellerId } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.gradeId
        ? { product: { gradeId: query.gradeId, deletedAt: null } }
        : {}),
    };

    const [totals, byStatus, lowStock, outOfStock, byGrade] = await Promise.all(
      [
        this.prisma.inventory.aggregate({
          where,
          _sum: {
            availableQty: true,
            reservedQty: true,
            soldQty: true,
          },
          _count: { _all: true },
        }),
        this.prisma.inventory.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
          _sum: { availableQty: true, reservedQty: true },
        }),
        this.prisma.inventory.count({
          where: { ...where, status: InventoryStatus.LOW },
        }),
        this.prisma.inventory.count({
          where: { ...where, status: InventoryStatus.OUT_OF_STOCK },
        }),
        this.prisma.$queryRaw<
          Array<{
            grade_id: string;
            code: string;
            available: Prisma.Decimal;
            reserved: Prisma.Decimal;
            products: bigint;
          }>
        >`
          SELECT g.id AS grade_id, g.code,
                 COALESCE(SUM(i.available_qty), 0) AS available,
                 COALESCE(SUM(i.reserved_qty), 0) AS reserved,
                 COUNT(DISTINCT i.product_id)::bigint AS products
          FROM inventory i
          JOIN products p ON p.id = i.product_id
          JOIN grades g ON g.id = p.grade_id
          WHERE i.deleted_at IS NULL
            ${query.sellerId ? Prisma.sql`AND i.seller_profile_id = ${query.sellerId}::uuid` : Prisma.empty}
            ${query.gradeId ? Prisma.sql`AND g.id = ${query.gradeId}::uuid` : Prisma.empty}
          GROUP BY g.id, g.code
          ORDER BY available DESC
          LIMIT 50
        `,
      ],
    );

    return {
      totalProducts: totals._count._all,
      availableQuantity: qtyStr(totals._sum.availableQty),
      reservedQuantity: qtyStr(totals._sum.reservedQty),
      soldQuantity: qtyStr(totals._sum.soldQty),
      lowStockProducts: lowStock,
      outOfStockProducts: outOfStock,
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: r._count._all,
        availableQuantity: qtyStr(r._sum.availableQty),
        reservedQuantity: qtyStr(r._sum.reservedQty),
      })),
      byGrade: byGrade.map((r) => ({
        gradeId: r.grade_id,
        code: r.code,
        availableQuantity: qtyStr(r.available),
        reservedQuantity: qtyStr(r.reserved),
        products: Number(r.products),
      })),
      note: 'Inventory snapshot is current state (not period-filtered). soldQty comes from Inventory.soldQty.',
    };
  }
}

@Injectable()
export class LogisticsSettlementAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async logistics(query: AnalyticsQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const createdAt = { gte: period.from, lte: period.to };

    const [dispatches, shipments, deliveries, qty] = await Promise.all([
      this.prisma.dispatch.groupBy({
        by: ['status'],
        where: { deletedAt: null, createdAt },
        _count: { _all: true },
        _sum: { quantity: true },
      }),
      this.prisma.shipment.groupBy({
        by: ['status'],
        where: { deletedAt: null, createdAt },
        _count: { _all: true },
        _sum: { quantity: true },
      }),
      this.prisma.delivery.groupBy({
        by: ['status'],
        where: { createdAt },
        _count: { _all: true },
        _sum: { quantity: true, deliveredQuantity: true },
      }),
      this.prisma.purchaseOrder.aggregate({
        where: {
          deletedAt: null,
          createdAt,
        },
        _sum: {
          orderedQuantity: true,
          dispatchedQuantity: true,
          deliveredQuantity: true,
        },
      }),
    ]);

    const dMap = Object.fromEntries(
      dispatches.map((r) => [r.status, r._count._all]),
    );
    const sMap = Object.fromEntries(
      shipments.map((r) => [r.status, r._count._all]),
    );
    const eMap = Object.fromEntries(
      deliveries.map((r) => [r.status, r._count._all]),
    );

    const ordered = toDecimal(qty._sum.orderedQuantity);
    const dispatched = toDecimal(qty._sum.dispatchedQuantity);
    const delivered = toDecimal(qty._sum.deliveredQuantity);

    return {
      dispatches: dispatches.reduce((a, r) => a + r._count._all, 0),
      readyForDispatch: dMap[DispatchStatus.READY_FOR_DISPATCH] ?? 0,
      loading: dMap[DispatchStatus.LOADING] ?? 0,
      loaded: dMap[DispatchStatus.LOADED] ?? 0,
      dispatched: dMap[DispatchStatus.DISPATCHED] ?? 0,
      shipments: shipments.reduce((a, r) => a + r._count._all, 0),
      inTransit: sMap[ShipmentStatus.IN_TRANSIT] ?? 0,
      outForDelivery: sMap[ShipmentStatus.OUT_FOR_DELIVERY] ?? 0,
      delivered:
        (sMap[ShipmentStatus.DELIVERED] ?? 0) +
        (sMap[ShipmentStatus.DELIVERY_CONFIRMED] ?? 0),
      deliveryConfirmed: sMap[ShipmentStatus.DELIVERY_CONFIRMED] ?? 0,
      exceptions:
        (sMap[ShipmentStatus.EXCEPTION] ?? 0) +
        (sMap[ShipmentStatus.FAILED] ?? 0) +
        (eMap[DeliveryStatus.EXCEPTION] ?? 0) +
        (eMap[DeliveryStatus.FAILED] ?? 0),
      cancelled:
        (dMap[DispatchStatus.CANCELLED] ?? 0) +
        (sMap[ShipmentStatus.CANCELLED] ?? 0) +
        (eMap[DeliveryStatus.CANCELLED] ?? 0),
      totalDispatchedQuantity: qtyStr(dispatched),
      totalDeliveredQuantity: qtyStr(delivered),
      remainingQuantity: qtyStr(ordered.minus(delivered)),
      partialDeliveries: eMap[DeliveryStatus.PARTIAL] ?? 0,
      byDispatchStatus: dispatches.map((r) => ({
        status: r.status,
        count: r._count._all,
        quantity: qtyStr(r._sum.quantity),
      })),
      byShipmentStatus: shipments.map((r) => ({
        status: r.status,
        count: r._count._all,
        quantity: qtyStr(r._sum.quantity),
      })),
      byDeliveryStatus: deliveries.map((r) => ({
        status: r.status,
        count: r._count._all,
        quantity: qtyStr(r._sum.quantity),
        deliveredQuantity: qtyStr(r._sum.deliveredQuantity),
      })),
      meta: periodMeta(period),
    };
  }

  async delivery(query: AnalyticsQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const where = { createdAt: { gte: period.from, lte: period.to } };

    const [byStatus, avgDuration] = await Promise.all([
      this.prisma.delivery.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<Array<{ avg_seconds: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM (confirmed_at - created_at))) AS avg_seconds
        FROM deliveries
        WHERE created_at >= ${period.from}
          AND created_at <= ${period.to}
          AND confirmed_at IS NOT NULL
          AND status::text IN ('CONFIRMED','DELIVERED')
      `,
    ]);

    const map = Object.fromEntries(
      byStatus.map((r) => [r.status, r._count._all]),
    );
    const avg = avgDuration[0]?.avg_seconds;

    return {
      scheduled: map[DeliveryStatus.SCHEDULED] ?? 0,
      delivered: map[DeliveryStatus.DELIVERED] ?? 0,
      confirmed: map[DeliveryStatus.CONFIRMED] ?? 0,
      failed: map[DeliveryStatus.FAILED] ?? 0,
      partial: map[DeliveryStatus.PARTIAL] ?? 0,
      cancelled: map[DeliveryStatus.CANCELLED] ?? 0,
      exceptions: map[DeliveryStatus.EXCEPTION] ?? 0,
      outForDelivery: map[DeliveryStatus.OUT_FOR_DELIVERY] ?? 0,
      averageDeliveryDurationSeconds:
        avg != null && Number.isFinite(Number(avg))
          ? Math.round(Number(avg))
          : null,
      meta: periodMeta(period),
    };
  }

  async settlements(query: AnalyticsQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const where: Prisma.SettlementWhereInput = {
      createdAt: { gte: period.from, lte: period.to },
      ...(query.sellerId ? { sellerProfileId: query.sellerId } : {}),
      ...(query.status ? { status: query.status as SettlementStatus } : {}),
    };

    const [byStatus, totals, bySeller] = await Promise.all([
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
      this.prisma.settlement.groupBy({
        by: ['sellerProfileId'],
        where,
        _count: { _all: true },
        _sum: { netAmount: true },
        orderBy: { _sum: { netAmount: 'desc' } },
        take: 20,
      }),
    ]);

    const map = Object.fromEntries(byStatus.map((r) => [r.status, r]));

    const amountFor = (...statuses: SettlementStatus[]) =>
      statuses.reduce(
        (acc, s) => acc.plus(toDecimal(map[s]?._sum.netAmount)),
        toDecimal(0),
      );

    const countFor = (...statuses: SettlementStatus[]) =>
      statuses.reduce((acc, s) => acc + (map[s]?._count._all ?? 0), 0);

    return {
      totalSettlements: totals._count._all,
      pending: countFor(SettlementStatus.PENDING, SettlementStatus.ON_HOLD),
      processing: countFor(SettlementStatus.PROCESSING, SettlementStatus.READY),
      completed: countFor(SettlementStatus.RELEASED),
      failed: countFor(SettlementStatus.FAILED),
      cancelled: countFor(SettlementStatus.CANCELLED),
      totalSettlementAmount: moneyStr(totals._sum.netAmount),
      pendingSettlementAmount: moneyStr(
        amountFor(
          SettlementStatus.PENDING,
          SettlementStatus.ON_HOLD,
          SettlementStatus.PROCESSING,
          SettlementStatus.READY,
        ),
      ),
      completedSettlementAmount: moneyStr(amountFor(SettlementStatus.RELEASED)),
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: r._count._all,
        netAmount: moneyStr(r._sum.netAmount),
        grossAmount: moneyStr(r._sum.grossAmount),
      })),
      bySeller: bySeller.map((r) => ({
        sellerProfileId: r.sellerProfileId,
        count: r._count._all,
        netAmount: moneyStr(r._sum.netAmount),
      })),
      meta: periodMeta(period),
      note: 'Settlement "completed" maps to status RELEASED in the current schema.',
    };
  }
}

@Injectable()
export class OverviewAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentAnalyticsService,
    private readonly logistics: LogisticsSettlementAnalyticsService,
  ) {}

  async overview(query: AnalyticsQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const orgs = await resolveOrgIds(this.prisma, query);
    const poWhere = buildPoWhere(period, orgs, query);
    const prWhere = buildPrWhere(period, orgs, query);
    const gmvWhere: Prisma.PurchaseOrderWhereInput = {
      ...poWhere,
      status: { in: GMV_PO_STATUSES },
    };

    const [
      gmvAgg,
      prTotal,
      prAccepted,
      prRejected,
      poTotal,
      payByStatus,
      sellersTotal,
      sellersActive,
      customersTotal,
      customersActive,
      inventory,
      logistics,
      settlements,
    ] = await Promise.all([
      this.prisma.purchaseOrder.aggregate({
        where: gmvWhere,
        _sum: { totalAmount: true, orderedQuantity: true },
        _count: { _all: true },
      }),
      this.prisma.purchaseRequest.count({ where: prWhere }),
      this.prisma.purchaseRequest.count({
        where: {
          ...prWhere,
          status: {
            in: ['APPROVED' as const, 'CONVERTED_TO_ORDER' as const],
          },
        },
      }),
      this.prisma.purchaseRequest.count({
        where: { ...prWhere, status: 'REJECTED' },
      }),
      this.prisma.purchaseOrder.count({ where: poWhere }),
      this.prisma.payment.groupBy({
        by: ['status'],
        where: {
          createdAt: { gte: period.from, lte: period.to },
          ...(orgs.customerOrgId ? { organizationId: orgs.customerOrgId } : {}),
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.sellerProfile.count({ where: { deletedAt: null } }),
      this.prisma.sellerProfile.count({
        where: { deletedAt: null, status: SellerStatus.APPROVED },
      }),
      this.prisma.customerProfile.count({ where: { deletedAt: null } }),
      this.prisma.customerProfile.count({
        where: { deletedAt: null, status: CustomerStatus.ACTIVE },
      }),
      this.prisma.inventory.aggregate({
        where: { deletedAt: null },
        _sum: { availableQty: true, reservedQty: true },
        _count: { _all: true },
      }),
      this.logistics.logistics(query),
      this.logistics.settlements(query),
    ]);

    const payMap = Object.fromEntries(payByStatus.map((r) => [r.status, r]));
    const payCount = (...ss: PaymentStatus[]) =>
      ss.reduce((a, s) => a + (payMap[s]?._count._all ?? 0), 0);
    const orders = gmvAgg._count._all;
    const gmv = toDecimal(gmvAgg._sum.totalAmount);

    return {
      period: { from: period.fromIso, to: period.toIso },
      sales: {
        gmv: moneyStr(gmv),
        orders,
        quantity: qtyStr(gmvAgg._sum.orderedQuantity),
        averageOrderValue: moneyStr(orders > 0 ? gmv.div(orders) : 0),
      },
      procurement: {
        purchaseRequests: prTotal,
        purchaseOrders: poTotal,
        acceptedRequests: prAccepted,
        rejectedRequests: prRejected,
      },
      payments: {
        total: payByStatus.reduce((a, r) => a + r._count._all, 0),
        verified: payCount(
          PaymentStatus.VERIFIED,
          PaymentStatus.PAID,
          PaymentStatus.PARTIALLY_PAID,
        ),
        pending: payCount(...PENDING_PAYMENT_STATUSES),
        rejected: payCount(PaymentStatus.REJECTED),
      },
      sellers: { active: sellersActive, total: sellersTotal },
      customers: { active: customersActive, total: customersTotal },
      inventory: {
        products: inventory._count._all,
        availableQuantity: qtyStr(inventory._sum.availableQty),
        reservedQuantity: qtyStr(inventory._sum.reservedQty),
      },
      logistics: {
        dispatches: logistics.dispatches,
        shipments: logistics.shipments,
        inTransit: logistics.inTransit,
        delivered: logistics.delivered,
        exceptions: logistics.exceptions,
      },
      settlements: {
        pending: settlements.pending,
        completed: settlements.completed,
        pendingAmount: settlements.pendingSettlementAmount,
      },
      meta: periodMeta(period),
    };
  }

  async finance(query: AnalyticsQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const orgs = await resolveOrgIds(this.prisma, query);
    const gmvWhere = buildPoWhere(period, orgs, query, {
      status: { in: GMV_PO_STATUSES },
    });

    const [gmvAgg, payments, refunds, settlements] = await Promise.all([
      this.prisma.purchaseOrder.aggregate({
        where: gmvWhere,
        _sum: { totalAmount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          createdAt: { gte: period.from, lte: period.to },
          status: { in: VERIFIED_PAYMENT_STATUSES },
        },
        _sum: { paidAmount: true, amount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          createdAt: { gte: period.from, lte: period.to },
          status: {
            in: [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED],
          },
        },
        _sum: { amount: true },
      }),
      this.prisma.settlement.aggregate({
        where: {
          createdAt: { gte: period.from, lte: period.to },
        },
        _sum: { netAmount: true },
      }),
    ]);

    const pendingPayments = await this.prisma.payment.aggregate({
      where: {
        createdAt: { gte: period.from, lte: period.to },
        status: { in: PENDING_PAYMENT_STATUSES },
      },
      _sum: { amount: true, pendingAmount: true },
    });

    const outstanding = await this.prisma.payment.aggregate({
      where: {
        status: {
          in: [
            ...PENDING_PAYMENT_STATUSES,
            PaymentStatus.PARTIALLY_PAID,
            PaymentStatus.OVERDUE,
          ],
        },
      },
      _sum: { pendingAmount: true },
    });

    return {
      gmv: moneyStr(gmvAgg._sum.totalAmount),
      paymentsReceived: moneyStr(
        payments._sum.paidAmount ?? payments._sum.amount,
      ),
      paymentsPending: moneyStr(
        pendingPayments._sum.pendingAmount ?? pendingPayments._sum.amount,
      ),
      refunds: moneyStr(refunds._sum.amount),
      settlements: moneyStr(settlements._sum.netAmount),
      outstandingAmounts: moneyStr(outstanding._sum.pendingAmount),
      creditRelatedOutstandingAmounts: null,
      note: 'creditRelatedOutstandingAmounts is null — no dedicated credit ledger model in schema yet. Terminology uses GMV / Payment Received / Pending / Settlement / Outstanding (not "revenue").',
      meta: periodMeta(period),
    };
  }

  async operationalStatus(query: AnalyticsQueryDto) {
    const period = resolveAnalyticsPeriod(query.from, query.to);
    const orgs = await resolveOrgIds(this.prisma, query);
    const createdAt = { gte: period.from, lte: period.to };

    const [
      purchaseRequests,
      purchaseOrders,
      clearance,
      readyForDispatch,
      inTransit,
      delivered,
      settlementPending,
    ] = await Promise.all([
      this.prisma.purchaseRequest.count({
        where: buildPrWhere(period, orgs, query),
      }),
      this.prisma.purchaseOrder.count({
        where: buildPoWhere(period, orgs, query),
      }),
      this.payments.paymentClearance(query),
      this.prisma.dispatch.count({
        where: {
          deletedAt: null,
          createdAt,
          status: DispatchStatus.READY_FOR_DISPATCH,
        },
      }),
      this.prisma.shipment.count({
        where: {
          deletedAt: null,
          createdAt,
          status: ShipmentStatus.IN_TRANSIT,
        },
      }),
      this.prisma.shipment.count({
        where: {
          deletedAt: null,
          createdAt,
          status: {
            in: [ShipmentStatus.DELIVERED, ShipmentStatus.DELIVERY_CONFIRMED],
          },
        },
      }),
      this.prisma.settlement.count({
        where: {
          createdAt,
          status: {
            in: [
              SettlementStatus.PENDING,
              SettlementStatus.PROCESSING,
              SettlementStatus.READY,
              SettlementStatus.ON_HOLD,
            ],
          },
        },
      }),
    ]);

    return {
      purchaseRequests,
      purchaseOrders,
      paymentPending: clearance.paymentPending,
      readyForDispatch,
      inTransit,
      delivered,
      settlementPending,
      meta: periodMeta(period),
    };
  }
}
