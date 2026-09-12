import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CustomerStatus,
  OrganizationType,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';

export type CustomerContext = {
  userId: string;
  customerProfileId: string;
  organizationId: string;
  status: CustomerStatus;
  organizationName: string;
};

@Injectable()
export class CustomerContextService {
  constructor(private readonly prisma: PrismaService) {}

  async requireCustomer(userId: string): Promise<CustomerContext> {
    const profile = await this.prisma.customerProfile.findFirst({
      where: { userId, deletedAt: null },
      include: { organization: true },
    });
    if (!profile) {
      throw new NotFoundException(
        'Customer profile not found. Complete customer onboarding first.',
      );
    }
    return {
      userId,
      customerProfileId: profile.id,
      organizationId: profile.organizationId,
      status: profile.status,
      organizationName: profile.organization.name,
    };
  }

  async getOrCreateCustomer(
    userId: string,
    seed?: {
      companyName?: string;
      email?: string | null;
      phone?: string | null;
    },
  ): Promise<CustomerContext> {
    const existing = await this.prisma.customerProfile.findFirst({
      where: { userId, deletedAt: null },
      include: { organization: true },
    });
    if (existing) {
      return {
        userId,
        customerProfileId: existing.id,
        organizationId: existing.organizationId,
        status: existing.status,
        organizationName: existing.organization.name,
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: seed?.companyName?.trim() || 'Customer Organization',
          legalName: seed?.companyName?.trim(),
          type: OrganizationType.CUSTOMER,
          email: seed?.email ?? undefined,
          phone: seed?.phone ?? undefined,
        },
      });
      await tx.organizationMember.create({
        data: {
          organizationId: org.id,
          userId,
          isPrimary: true,
          joinedAt: new Date(),
        },
      });
      const profile = await tx.customerProfile.create({
        data: {
          userId,
          organizationId: org.id,
          status: CustomerStatus.ACTIVE,
        },
      });
      return { org, profile };
    });

    return {
      userId,
      customerProfileId: result.profile.id,
      organizationId: result.org.id,
      status: result.profile.status,
      organizationName: result.org.name,
    };
  }

  assertOwnership(ctx: CustomerContext, organizationId: string) {
    if (ctx.organizationId !== organizationId) {
      throw new ForbiddenException('UNAUTHORIZED_CUSTOMER_RESOURCE');
    }
  }
}

export function nextPrReference(): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
  return `PR-${year}-${rand}`;
}

export const PR_RESPONSE_WINDOW_MS = 15 * 60 * 1000;
