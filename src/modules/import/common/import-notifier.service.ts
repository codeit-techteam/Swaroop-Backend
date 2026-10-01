import { Injectable, Logger } from '@nestjs/common';
import {
  EntityOwnerType,
  ManagerAssignmentStatus,
  MembershipStatus,
  NotificationChannel,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { NotificationService } from '../../notifications/notification.service.js';
import type { ImportNotificationEvent } from '../domain/import.constants.js';

export type ImportNotice = {
  organizationId: string;
  event: ImportNotificationEvent;
  title: string;
  body: string;
  entityType: EntityOwnerType;
  entityId: string;
  /** Never include counterparty identities — the marketplace is blind. */
  metadata?: Record<string, unknown>;
  excludeUserId?: string;
};

/**
 * Delivers Import events through the existing Notification table (IN_APP is the
 * only channel with a live dispatcher today). Recipients: active organisation
 * members, the org's customer/seller profile owner and active Seller Managers
 * granted `import.view`. Users who disabled the event key are skipped.
 */
@Injectable()
export class ImportNotifierService {
  private readonly logger = new Logger(ImportNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async recipients(organizationId: string): Promise<string[]> {
    const [members, customers, sellers] = await Promise.all([
      this.prisma.organizationMember.findMany({
        where: { organizationId, status: MembershipStatus.ACTIVE },
        select: { userId: true },
      }),
      this.prisma.customerProfile.findMany({
        where: { organizationId, deletedAt: null },
        select: { userId: true },
      }),
      this.prisma.sellerProfile.findMany({
        where: { organizationId, deletedAt: null },
        select: {
          userId: true,
          managerAssignments: {
            where: {
              status: ManagerAssignmentStatus.ACTIVE,
              user: { permissionGrants: { some: { code: 'import.view' } } },
            },
            select: { userId: true },
          },
        },
      }),
    ]);

    const ids = new Set<string>();
    for (const m of members) ids.add(m.userId);
    for (const c of customers) if (c.userId) ids.add(c.userId);
    for (const s of sellers) {
      if (s.userId) ids.add(s.userId);
      for (const a of s.managerAssignments) ids.add(a.userId);
    }
    return [...ids];
  }

  async notify(notice: ImportNotice): Promise<number> {
    try {
      const all = (await this.recipients(notice.organizationId)).filter(
        (id) => id !== notice.excludeUserId,
      );
      if (all.length === 0) return 0;

      const muted = await this.prisma.notificationPreference.findMany({
        where: {
          userId: { in: all },
          channel: NotificationChannel.IN_APP,
          eventKey: notice.event,
          enabled: false,
        },
        select: { userId: true },
      });
      const mutedIds = new Set(muted.map((m) => m.userId));

      let sent = 0;
      for (const userId of all) {
        if (mutedIds.has(userId)) continue;
        await this.notifications.create({
          userId,
          organizationId: notice.organizationId,
          title: notice.title,
          body: notice.body,
          entityType: notice.entityType,
          entityId: notice.entityId,
          channel: NotificationChannel.IN_APP,
          metadata: {
            eventKey: notice.event,
            module: 'IMPORT',
            ...notice.metadata,
          },
        });
        sent += 1;
      }
      return sent;
    } catch (error) {
      // A notification failure must never roll back a trade action.
      this.logger.error(
        `Import notification ${notice.event} failed for ${notice.entityType}:${notice.entityId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    }
  }
}
