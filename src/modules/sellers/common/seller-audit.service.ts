import { Injectable } from '@nestjs/common';
import { EntityOwnerType } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';

@Injectable()
export class SellerAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: {
    action: string;
    actorUserId?: string;
    organizationId?: string;
    entityType?: EntityOwnerType;
    entityId?: string;
    previousData?: unknown;
    newData?: unknown;
    metadata?: Record<string, unknown>;
  }) {
    await this.prisma.auditLog.create({
      data: {
        action: input.action,
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        entityType: input.entityType ?? EntityOwnerType.SELLER,
        entityId: input.entityId,
        previousData: input.previousData as object | undefined,
        newData: input.newData as object | undefined,
        metadata: input.metadata as object | undefined,
      },
    });
  }
}
