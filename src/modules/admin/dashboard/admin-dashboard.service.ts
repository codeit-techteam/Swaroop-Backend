import { Injectable } from '@nestjs/common';
import {
  DocumentStatus,
  NotificationStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { RoleCode } from '../../../common/enums/domain.enums.js';

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
    };
  }
}
