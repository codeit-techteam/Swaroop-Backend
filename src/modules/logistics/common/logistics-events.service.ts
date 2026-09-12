import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';

type TxClient = Prisma.TransactionClient;

export type LogisticsEventInput = {
  purchaseOrderId?: string | null;
  dispatchId?: string | null;
  shipmentId?: string | null;
  deliveryId?: string | null;
  eventType: string;
  actorRole?: string | null;
  actorUserId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

@Injectable()
export class LogisticsEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    tx: TxClient | PrismaService,
    input: LogisticsEventInput,
  ): Promise<void> {
    await tx.logisticsEvent.create({
      data: {
        purchaseOrderId: input.purchaseOrderId ?? undefined,
        dispatchId: input.dispatchId ?? undefined,
        shipmentId: input.shipmentId ?? undefined,
        deliveryId: input.deliveryId ?? undefined,
        eventType: input.eventType,
        actorRole: input.actorRole ?? undefined,
        actorUserId: input.actorUserId ?? undefined,
        metadata: input.metadata ?? undefined,
      },
    });
  }
}
