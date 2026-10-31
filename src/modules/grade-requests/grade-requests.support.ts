import { Injectable, Logger } from '@nestjs/common';
import {
  EntityOwnerType,
  NewGradeRequestStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import { RoleCode } from '../../common/enums/domain.enums.js';
import { PrismaService } from '../../database/prisma.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { GRADE_REQUEST_STATUS_LABELS } from './grade-requests.shared.js';

type Db = Prisma.TransactionClient | PrismaService;

/** Admin roles that receive new-grade-request notifications. */
export const GRADE_REQUEST_ADMIN_ROLES = [
  RoleCode.ADMIN,
  RoleCode.SUPER_ADMIN,
  RoleCode.PROCUREMENT_MANAGER,
  RoleCode.OPERATIONS_MANAGER,
] as const;

/**
 * Shared side-effects for new-grade requests: decision history, audit trail and
 * notifications. Notification failures never roll back the business action.
 */
@Injectable()
export class GradeRequestSupport {
  private readonly logger = new Logger(GradeRequestSupport.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  recordEvent(
    db: Db,
    input: {
      requestId: string;
      eventType: string;
      actorRole: 'CUSTOMER' | 'ADMIN' | 'SYSTEM';
      actorUserId?: string | null;
      fromStatus?: NewGradeRequestStatus | null;
      toStatus?: NewGradeRequestStatus | null;
      message?: string | null;
      internal?: boolean;
      metadata?: Record<string, unknown>;
    },
  ) {
    return db.newGradeRequestEvent.create({
      data: {
        requestId: input.requestId,
        eventType: input.eventType,
        actorRole: input.actorRole,
        actorUserId: input.actorUserId ?? null,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        message: input.message ?? null,
        internal: input.internal ?? false,
        metadata: (input.metadata ?? undefined) as
          Prisma.InputJsonValue | undefined,
      },
    });
  }

  async audit(input: {
    action: string;
    actorUserId: string;
    organizationId?: string;
    requestId: string;
    previousData?: unknown;
    newData?: unknown;
    metadata?: Record<string, unknown>;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: input.action,
          actorUserId: input.actorUserId,
          organizationId: input.organizationId,
          entityType: EntityOwnerType.NEW_GRADE_REQUEST,
          entityId: input.requestId,
          previousData: input.previousData as Prisma.InputJsonValue | undefined,
          newData: input.newData as Prisma.InputJsonValue | undefined,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (error) {
      this.logger.error(
        `Audit write failed action=${input.action} request=${input.requestId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async notifyAdmins(
    request: {
      id: string;
      referenceNumber: string;
      assignedAdminId?: string | null;
    },
    title: string,
    body: string,
  ) {
    try {
      const rows = await this.prisma.userRole.findMany({
        where: { role: { code: { in: [...GRADE_REQUEST_ADMIN_ROLES] } } },
        select: { userId: true },
        distinct: ['userId'],
      });
      const recipients = new Set(rows.map((r) => r.userId));
      // When someone owns the request only they (and core admins) are pinged on updates.
      await Promise.all(
        [...recipients].map((userId) =>
          this.notifications.create({
            userId,
            title,
            body,
            entityType: EntityOwnerType.NEW_GRADE_REQUEST,
            entityId: request.id,
            metadata: {
              referenceNumber: request.referenceNumber,
              eventKey: 'NEW_GRADE_REQUEST_ADMIN',
            },
          }),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Admin notification failed for ${request.referenceNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async notifyCustomer(
    request: {
      id: string;
      referenceNumber: string;
      requestedById: string | null;
      organizationId?: string;
    },
    title: string,
    body: string,
    eventKey: string,
  ) {
    if (!request.requestedById) return;
    try {
      await this.notifications.create({
        userId: request.requestedById,
        organizationId: request.organizationId,
        title,
        body,
        entityType: EntityOwnerType.NEW_GRADE_REQUEST,
        entityId: request.id,
        metadata: { referenceNumber: request.referenceNumber, eventKey },
      });
    } catch (error) {
      this.logger.warn(
        `Customer notification failed for ${request.referenceNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  statusNotification(
    referenceNumber: string,
    status: NewGradeRequestStatus,
    message?: string | null,
  ) {
    const label = GRADE_REQUEST_STATUS_LABELS[status];
    return {
      title: `Grade request ${referenceNumber}: ${label}`,
      body: message?.trim() || `Your request status is now "${label}".`,
    };
  }
}
