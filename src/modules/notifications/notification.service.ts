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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DISPLAY_REF_KEYS = [
  'displayReference',
  'referenceNumber',
  'reference',
  'orderNumber',
  'poNumber',
  'invoiceNumber',
  'ticketNumber',
  'applicationNumber',
  'requestNumber',
  'settlementNumber',
  'shipmentNumber',
  'dealNumber',
  'listingNumber',
] as const;

function asHumanReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || UUID_RE.test(trimmed)) return null;
  return trimmed;
}

/** Prefer business reference numbers; never return a raw UUID. */
export function resolveDisplayReference(
  metadata?: Record<string, unknown> | null,
): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  for (const key of DISPLAY_REF_KEYS) {
    const hit = asHumanReference(metadata[key]);
    if (hit) return hit;
  }
  return null;
}

/** Client-facing notification DTO — entityId kept for deep links only. */
export function toPublicNotification<
  T extends {
    id: string;
    title: string;
    body: string;
    entityType: EntityOwnerType | null;
    entityId: string | null;
    metadata: unknown;
    status: NotificationStatus;
    readAt: Date | null;
    sentAt: Date | null;
    createdAt: Date;
    channel: NotificationChannel;
  },
>(row: T) {
  const metadata =
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : {};
  const displayReference = resolveDisplayReference(metadata);
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    channel: row.channel,
    status: row.status,
    entityType: row.entityType,
    entityId: row.entityId,
    displayReference,
    metadata: {
      ...metadata,
      ...(displayReference ? { displayReference } : {}),
    },
    readAt: row.readAt,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateNotificationInput) {
    const metadata = { ...(input.metadata ?? {}) };
    const displayReference = resolveDisplayReference(metadata);
    if (displayReference && !metadata.displayReference) {
      metadata.displayReference = displayReference;
    }
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
        metadata: metadata as Prisma.InputJsonValue,
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

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      items: rows.map((row) => toPublicNotification(row)),
      meta: paginationMeta(page, limit, total),
    };
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
    const updated = await this.prisma.notification.update({
      where: { id },
      data: {
        status: NotificationStatus.READ,
        readAt: new Date(),
      },
    });
    return toPublicNotification(updated);
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
