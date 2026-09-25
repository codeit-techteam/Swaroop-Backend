import { Injectable, Logger } from '@nestjs/common';
import {
  EntityOwnerType,
  NegotiationActorRole,
  type Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';

export const PR_EVENT_TYPES = [
  'PURCHASE_REQUEST_CREATED',
  'SELLER_MATCHED',
  'SENT_TO_SELLER',
  'PURCHASE_REQUEST_VIEWED_BY_SELLER',
  'SELLER_ACCEPTED',
  'SELLER_REJECTED',
  'SELLER_COUNTER_OFFERED',
  'CUSTOMER_COUNTER_OFFERED',
  'COUNTER_ACCEPTED',
  'COUNTER_REJECTED',
  'RESPONSE_WINDOW_WARNING',
  'PURCHASE_REQUEST_EXPIRED',
  'PURCHASE_REQUEST_CANCELLED',
  'COMMERCIAL_TERMS_ACCEPTED',
  'PURCHASE_ORDER_CREATED',
  'ADMIN_NOTE_ADDED',
  'ADMIN_MARKED_FOR_REVIEW',
  'ADMIN_ESCALATED',
] as const;

export type PrEventType = (typeof PR_EVENT_TYPES)[number];

type TxClient = Prisma.TransactionClient;

@Injectable()
export class PrEventsService {
  private readonly logger = new Logger(PrEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    tx: TxClient | PrismaService,
    input: {
      purchaseRequestId: string;
      eventType: PrEventType | string;
      actorRole?: NegotiationActorRole | null;
      actorUserId?: string | null;
      metadata?: Record<string, unknown> | null;
    },
  ) {
    return tx.purchaseRequestEvent.create({
      data: {
        purchaseRequestId: input.purchaseRequestId,
        eventType: input.eventType,
        actorRole: input.actorRole ?? undefined,
        actorUserId: input.actorUserId ?? undefined,
        metadata: (input.metadata ?? undefined) as
          Prisma.InputJsonValue | undefined,
      },
    });
  }

  /**
   * Optional in-app notification stub — writes AuditLog when possible.
   */
  async notifyStub(input: {
    actorUserId?: string | null;
    organizationId?: string | null;
    purchaseRequestId: string;
    eventType: string;
    message?: string;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: `PROCUREMENT_NOTIFY_${input.eventType}`,
          actorUserId: input.actorUserId ?? undefined,
          organizationId: input.organizationId ?? undefined,
          entityType: EntityOwnerType.PURCHASE_REQUEST,
          entityId: input.purchaseRequestId,
          metadata: {
            eventType: input.eventType,
            message: input.message ?? null,
          },
        },
      });
    } catch (err) {
      this.logger.debug(
        `notifyStub skipped for ${input.eventType}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
