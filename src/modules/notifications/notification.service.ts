import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EntityOwnerType,
  NotificationChannel,
  NotificationStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { paginationMeta, skipTake } from '../master-data/common/pagination.js';

export type CreateNotificationInput = {
  userId: string;
  title: string;
  body: string;
  organizationId?: string;
  entityType?: EntityOwnerType;
  entityId?: string;
  channel?: NotificationChannel;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateNotificationInput) {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        organizationId: input.organizationId,
        channel: input.channel ?? NotificationChannel.IN_APP,
        status: NotificationStatus.PENDING,
        title: input.title,
        body: input.body,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
        sentAt: new Date(),
      },
    });
  }

  async listForUser(
    userId: string,
    query: { page?: number; limit?: number; unreadOnly?: boolean },
  ) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly
        ? {
            OR: [
              { status: { not: NotificationStatus.READ } },
              { readAt: null },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: {
        userId,
        status: {
          notIn: [NotificationStatus.READ, NotificationStatus.ARCHIVED],
        },
        readAt: null,
      },
    });
    return { count };
  }

  async markRead(userId: string, id: string) {
    const existing = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new NotFoundException('Notification not found');
    }
    return this.prisma.notification.update({
      where: { id },
      data: {
        status: NotificationStatus.READ,
        readAt: new Date(),
      },
    });
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        OR: [{ readAt: null }, { status: { not: NotificationStatus.READ } }],
      },
      data: {
        status: NotificationStatus.READ,
        readAt: new Date(),
      },
    });
    return { updated: result.count };
  }
}
