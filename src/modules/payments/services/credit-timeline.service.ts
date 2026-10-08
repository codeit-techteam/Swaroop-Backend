import { Injectable } from '@nestjs/common';
import { EntityOwnerType, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { CreditApplicationEventType } from '../common/credit-workflow.js';

export type CreditTimelineInput = {
  creditApplicationId: string;
  eventType: CreditApplicationEventType | string;
  description: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  /** Only set true for wording that is safe to show the customer. */
  customerVisible?: boolean;
  metadata?: Record<string, unknown>;
  /** When set, an AuditLog row is written alongside the timeline event. */
  audit?: {
    organizationId?: string;
    previousData?: unknown;
    newData?: unknown;
  };
};

type Client = PrismaService | Prisma.TransactionClient;

@Injectable()
export class CreditTimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: CreditTimelineInput, client?: Client) {
    const db = client ?? this.prisma;
    const event = await db.creditApplicationEvent.create({
      data: {
        creditApplicationId: input.creditApplicationId,
        eventType: input.eventType,
        actorUserId: input.actorUserId ?? undefined,
        actorRole: input.actorRole ?? undefined,
        customerVisible: input.customerVisible ?? false,
        description: input.description,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });

    if (input.audit) {
      await db.auditLog.create({
        data: {
          action: input.eventType,
          actorUserId: input.actorUserId ?? undefined,
          organizationId: input.audit.organizationId,
          entityType: EntityOwnerType.CREDIT,
          entityId: input.creditApplicationId,
          previousData: input.audit.previousData as object | undefined,
          newData: input.audit.newData as object | undefined,
        },
      });
    }

    return event;
  }

  async list(
    creditApplicationId: string,
    opts?: { customerVisibleOnly?: boolean; take?: number },
  ) {
    const customerView = opts?.customerVisibleOnly === true;
    const rows = await this.prisma.creditApplicationEvent.findMany({
      where: {
        creditApplicationId,
        ...(customerView ? { customerVisible: true } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: opts?.take ?? 200,
      // Staff names stay internal; customers only see the actor role.
      include: customerView
        ? undefined
        : {
            actor: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
                email: true,
              },
            },
          },
    });
    return rows.map((row) => {
      const actor = (
        row as typeof row & {
          actor?: {
            firstName: string | null;
            lastName: string | null;
            displayName: string | null;
            email: string | null;
          } | null;
        }
      ).actor;
      const actorName = actor
        ? actor.displayName ||
          [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim() ||
          actor.email
        : null;
      return {
        id: row.id,
        eventType: row.eventType,
        description: row.description,
        actorRole: row.actorRole,
        ...(customerView ? {} : { actorUserId: row.actorUserId, actorName }),
        customerVisible: row.customerVisible,
        metadata: row.metadata,
        createdAt: row.createdAt,
      };
    });
  }
}
