import { Injectable } from '@nestjs/common';
import { EntityOwnerType, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: {
    action: string;
    actorUserId?: string;
    organizationId?: string;
    entityType: EntityOwnerType;
    entityId?: string;
    previousData?: unknown;
    newData?: unknown;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.prisma.auditLog.create({
      data: {
        action: input.action,
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        previousData: input.previousData as Prisma.InputJsonValue | undefined,
        newData: input.newData as Prisma.InputJsonValue | undefined,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }
}
