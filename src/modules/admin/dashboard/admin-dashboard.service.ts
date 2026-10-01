import { Injectable } from '@nestjs/common';
import {
  CreditApplicationStatus,
  CreditStatus,
  CustomerStatus,
  DocumentStatus,
  ImportDealStatus,
  ImportListingStatus,
  ImportNegotiationStatus,
  ImportSide,
  NotificationStatus,
  OrderStatus,
  PaymentStatus,
  PurchaseRequestSellerMatchStatus,
  PurchaseRequestStatus,
  SellerStatus,
  ShipmentStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { toDecimal } from '../../payments/common/money.util.js';

const ACTIVE_IMPORT: ImportListingStatus[] = [
  ImportListingStatus.PUBLISHED,
  ImportListingStatus.MATCHING,
  ImportListingStatus.OFFER_RECEIVED,
  ImportListingStatus.NEGOTIATION,
  ImportListingStatus.MATCHED,
];

function sumOf(
  rows: Array<{ status: string; _count: { _all: number } }>,
  keys: string[],
) {
  const allowed = new Set(keys);
  return rows.reduce(
    (total, row) => (allowed.has(row.status) ? total + row._count._all : total),
    0,
  );
}

function sinceDate(days?: number) {
  if (!days) return undefined;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(days?: number) {
    const adminRoleCodes = [
      RoleCode.ADMIN,
      RoleCode.SUPER_ADMIN,
      RoleCode.FINANCE_MANAGER,
      RoleCode.OPERATIONS_MANAGER,
      RoleCode.COMPLIANCE_MANAGER,
      RoleCode.PROCUREMENT_MANAGER,
    ];

    const [
      users,
      customers,
      sellers,
      grades,
      products,
      offers,
      purchaseRequests,
      purchaseOrders,
      payments,
      shipments,
      documentsPending,
      adminUserIds,
      pendingCreditApplications,
      approvedCreditAccounts,
      creditTotals,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.customerProfile.count({ where: { deletedAt: null } }),
      this.prisma.sellerProfile.count({ where: { deletedAt: null } }),
      this.prisma.grade.count({ where: { deletedAt: null } }),
      this.prisma.product.count({ where: { deletedAt: null } }),
      this.prisma.offer.count({ where: { deletedAt: null } }),
      this.prisma.purchaseRequest.count({ where: { deletedAt: null } }),
      this.prisma.purchaseOrder.count({ where: { deletedAt: null } }),
      this.prisma.payment.count(),
      this.prisma.shipment.count({ where: { deletedAt: null } }),
      this.prisma.document.count({
        where: {
          deletedAt: null,
          status: {
            in: [DocumentStatus.UPLOADED, DocumentStatus.UNDER_REVIEW],
          },
        },
      }),
      this.prisma.userRole.findMany({
        where: { role: { code: { in: adminRoleCodes } } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.creditApplication.count({
        where: { status: CreditApplicationStatus.PENDING },
      }),
      this.prisma.customerCreditProfile.count({
        where: { status: CreditStatus.APPROVED },
      }),
      this.prisma.customerCreditProfile.aggregate({
        _sum: {
          approvedLimit: true,
          outstandingAmount: true,
          overdueAmount: true,
        },
      }),
    ]);

    const adminIds = adminUserIds.map((r) => r.userId);
    const since = sinceDate(days);
    const windowWhere = since ? { createdAt: { gte: since } } : {};
    const live = { deletedAt: null, ...windowWhere };

    const [
      notificationsUnread,
      customerStatuses,
      sellerStatuses,
      orderStatuses,
      purchaseRequestStatuses,
      counterOffered,
      paymentStatuses,
      shipmentStatuses,
      activeBuyRequests,
      activeSellOffers,
      openNegotiations,
      confirmedDeals,
      recentOrders,
      recentPurchaseRequests,
    ] = await Promise.all([
      adminIds.length === 0
        ? Promise.resolve(0)
        : this.prisma.notification.count({
            where: {
              userId: { in: adminIds },
              status: {
                notIn: [NotificationStatus.READ, NotificationStatus.ARCHIVED],
              },
              readAt: null,
            },
          }),
      this.prisma.customerProfile.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.sellerProfile.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: live,
        _count: { _all: true },
      }),
      this.prisma.purchaseRequest.groupBy({
        by: ['status'],
        where: live,
        _count: { _all: true },
      }),
      this.prisma.purchaseRequestSellerMatch.count({
        where: {
          status: PurchaseRequestSellerMatchStatus.COUNTER_OFFERED,
          ...windowWhere,
        },
      }),
      this.prisma.payment.groupBy({
        by: ['status'],
        where: windowWhere,
        _count: { _all: true },
      }),
      this.prisma.shipment.groupBy({
        by: ['status'],
        where: live,
        _count: { _all: true },
      }),
      this.prisma.importListing.count({
        where: {
          deletedAt: null,
          side: ImportSide.BUY,
          status: { in: ACTIVE_IMPORT },
          ...windowWhere,
        },
      }),
      this.prisma.importListing.count({
        where: {
          deletedAt: null,
          side: ImportSide.SELL,
          status: { in: ACTIVE_IMPORT },
          ...windowWhere,
        },
      }),
      this.prisma.importNegotiation.count({
        where: { status: ImportNegotiationStatus.OPEN, ...windowWhere },
      }),
      this.prisma.importDeal.count({
        where: {
          status: {
            in: [
              ImportDealStatus.CONFIRMED,
              ImportDealStatus.PARTIALLY_FULFILLED,
            ],
          },
          ...windowWhere,
        },
      }),
      this.prisma.order.findMany({
        where: live,
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          referenceNumber: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          customerOrg: { select: { name: true } },
        },
      }),
      this.prisma.purchaseRequest.findMany({
        where: live,
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          referenceNumber: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      users,
      customers,
      sellers,
      grades,
      products,
      offers,
      purchaseRequests,
      purchaseOrders,
      payments,
      logistics: shipments,
      shipments,
      documentsPending,
      notificationsUnread,
      windowDays: days ?? null,
      operations: {
        customers: {
          total: customers,
          active: sumOf(customerStatuses, [CustomerStatus.ACTIVE]),
          pendingKyc: sumOf(customerStatuses, [CustomerStatus.PENDING_KYC]),
          suspended: sumOf(customerStatuses, [CustomerStatus.SUSPENDED]),
        },
        sellers: {
          total: sellers,
          active: sumOf(sellerStatuses, [SellerStatus.APPROVED]),
          pendingApproval: sumOf(sellerStatuses, [
            SellerStatus.PENDING_VERIFICATION,
            SellerStatus.UNDER_REVIEW,
          ]),
          suspended: sumOf(sellerStatuses, [SellerStatus.SUSPENDED]),
        },
        orders: {
          total: orderStatuses.reduce((n, row) => n + row._count._all, 0),
          created: sumOf(orderStatuses, [
            OrderStatus.CREATED,
            OrderStatus.PROCUREMENT_STARTED,
            OrderStatus.SUPPLIER_MATCHING,
            OrderStatus.CONFIRMED,
          ]),
          processing: sumOf(orderStatuses, [
            OrderStatus.PROCESSING,
            OrderStatus.LOADING_SCHEDULED,
            OrderStatus.LOADING_COMPLETED,
            OrderStatus.PAYMENT_PENDING,
            OrderStatus.PAYMENT_VERIFIED,
          ]),
          dispatched: sumOf(orderStatuses, [
            OrderStatus.DISPATCH_READY,
            OrderStatus.DISPATCHED,
          ]),
          delivered: sumOf(orderStatuses, [
            OrderStatus.DELIVERED,
            OrderStatus.COMPLETED,
          ]),
          cancelled: sumOf(orderStatuses, [OrderStatus.CANCELLED]),
        },
        purchaseRequests: {
          total: purchaseRequestStatuses.reduce(
            (n, row) => n + row._count._all,
            0,
          ),
          created: sumOf(purchaseRequestStatuses, [
            PurchaseRequestStatus.DRAFT,
            PurchaseRequestStatus.SUBMITTED,
          ]),
          pendingSellerResponse: sumOf(purchaseRequestStatuses, [
            PurchaseRequestStatus.UNDER_REVIEW,
            PurchaseRequestStatus.SOURCING,
            PurchaseRequestStatus.OFFER_RECEIVED,
            PurchaseRequestStatus.NEGOTIATION,
            PurchaseRequestStatus.PENDING_APPROVAL,
          ]),
          accepted: sumOf(purchaseRequestStatuses, [
            PurchaseRequestStatus.APPROVED,
            PurchaseRequestStatus.CONVERTED_TO_ORDER,
          ]),
          rejected: sumOf(purchaseRequestStatuses, [
            PurchaseRequestStatus.REJECTED,
          ]),
          counterOffered,
          expired: sumOf(purchaseRequestStatuses, [
            PurchaseRequestStatus.EXPIRED,
          ]),
        },
        importTrading: {
          activeBuyRequests,
          activeSellOffers,
          openNegotiations,
          confirmedDeals,
        },
        payments: {
          pending: sumOf(paymentStatuses, [
            PaymentStatus.INITIATED,
            PaymentStatus.PENDING,
            PaymentStatus.AUTHORIZED,
            PaymentStatus.SUBMITTED,
          ]),
          verificationRequired: sumOf(paymentStatuses, [
            PaymentStatus.UNDER_VERIFICATION,
          ]),
          success: sumOf(paymentStatuses, [
            PaymentStatus.VERIFIED,
            PaymentStatus.PAID,
            PaymentStatus.PARTIALLY_PAID,
          ]),
          failed: sumOf(paymentStatuses, [
            PaymentStatus.FAILED,
            PaymentStatus.REJECTED,
            PaymentStatus.CANCELLED,
          ]),
          refunded: sumOf(paymentStatuses, [
            PaymentStatus.REFUNDED,
            PaymentStatus.PARTIALLY_REFUNDED,
          ]),
        },
        logistics: {
          readyForDispatch: sumOf(shipmentStatuses, [
            ShipmentStatus.PLANNED,
            ShipmentStatus.SLOT_BOOKED,
            ShipmentStatus.READY_TO_DISPATCH,
            ShipmentStatus.LOADING,
          ]),
          dispatched: sumOf(shipmentStatuses, [ShipmentStatus.DISPATCHED]),
          inTransit: sumOf(shipmentStatuses, [
            ShipmentStatus.IN_TRANSIT,
            ShipmentStatus.OUT_FOR_DELIVERY,
          ]),
          delivered: sumOf(shipmentStatuses, [
            ShipmentStatus.DELIVERED,
            ShipmentStatus.DELIVERY_CONFIRMED,
          ]),
          delayed: sumOf(shipmentStatuses, [
            ShipmentStatus.DELAYED,
            ShipmentStatus.EXCEPTION,
            ShipmentStatus.FAILED,
          ]),
        },
        recentOrders: recentOrders.map((order) => ({
          id: order.id,
          referenceNumber: order.referenceNumber,
          status: order.status,
          totalAmount: order.totalAmount.toString(),
          customer: order.customerOrg.name,
          createdAt: order.createdAt,
        })),
        recentPurchaseRequests: recentPurchaseRequests,
      },
      credit: {
        pendingApplications: pendingCreditApplications,
        approvedAccounts: approvedCreditAccounts,
        outstandingAmount: toDecimal(
          creditTotals._sum.outstandingAmount,
        ).toFixed(2),
        overdueAmount: toDecimal(creditTotals._sum.overdueAmount).toFixed(2),
        approvedLimit: toDecimal(creditTotals._sum.approvedLimit).toFixed(2),
      },
    };
  }

  async catalogSummary() {
    const [grades, products, offers, categories, inventory] = await Promise.all(
      [
        this.prisma.grade.count({ where: { deletedAt: null } }),
        this.prisma.product.count({ where: { deletedAt: null } }),
        this.prisma.offer.count({ where: { deletedAt: null } }),
        this.prisma.gradeCategory.count({ where: { deletedAt: null } }),
        this.prisma.inventory.count({ where: { deletedAt: null } }),
      ],
    );
    return { grades, products, offers, categories, inventory };
  }

  async ordersSummary() {
    const [purchaseRequests, purchaseOrders, orders] = await Promise.all([
      this.prisma.purchaseRequest.count({ where: { deletedAt: null } }),
      this.prisma.purchaseOrder.count({ where: { deletedAt: null } }),
      this.prisma.order.count({ where: { deletedAt: null } }),
    ]);
    const gmv = await this.prisma.purchaseOrder.aggregate({
      where: { deletedAt: null },
      _sum: { totalAmount: true },
    });
    return {
      purchaseRequests,
      purchaseOrders,
      orders,
      gmv: toDecimal(gmv._sum.totalAmount).toFixed(2),
    };
  }
}
