import { Injectable } from '@nestjs/common';
import {
  CreditApplicationStatus,
  CreditStatus,
  DocumentStatus,
  NotificationStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { toDecimal } from '../../payments/common/money.util.js';

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
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
    const notificationsUnread =
      adminIds.length === 0
        ? 0
        : await this.prisma.notification.count({
            where: {
              userId: { in: adminIds },
              status: {
                notIn: [NotificationStatus.READ, NotificationStatus.ARCHIVED],
              },
              readAt: null,
            },
          });

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
