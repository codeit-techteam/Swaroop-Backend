import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';

type TxClient = Prisma.TransactionClient;

export type FinanceEventInput = {
  purchaseOrderId?: string | null;
  paymentId?: string | null;
  eventType: string;
  actorRole?: string | null;
  actorUserId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

@Injectable()
export class FinanceEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    tx: TxClient | PrismaService,
    input: FinanceEventInput,
  ): Promise<void> {
    await tx.financeEvent.create({
      data: {
        purchaseOrderId: input.purchaseOrderId ?? undefined,
        paymentId: input.paymentId ?? undefined,
        eventType: input.eventType,
        actorRole: input.actorRole ?? undefined,
        actorUserId: input.actorUserId ?? undefined,
        metadata: input.metadata ?? undefined,
      },
    });
  }
}
