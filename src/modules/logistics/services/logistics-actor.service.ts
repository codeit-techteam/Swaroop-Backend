import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { resolveSellerActor } from '../../sellers/common/resolve-seller-actor.js';
import { LogisticsException } from '../common/logistics.errors.js';

@Injectable()
export class LogisticsActorService {
  constructor(private readonly prisma: PrismaService) {}

  async requireCustomerOrg(userId: string): Promise<{
    userId: string;
    organizationId: string;
    customerProfileId: string;
  }> {
    const profile = await this.prisma.customerProfile.findFirst({
      where: { userId, deletedAt: null },
    });
    if (!profile) {
      throw new NotFoundException(
        'Customer profile not found. Complete customer onboarding first.',
      );
    }
    return {
      userId,
      organizationId: profile.organizationId,
      customerProfileId: profile.id,
    };
  }

  async requireSellerOrg(userId: string): Promise<{
    userId: string;
    organizationId: string;
    sellerProfileId: string;
  }> {
    const resolved = await resolveSellerActor(this.prisma, userId);
    if (!resolved) {
      throw new NotFoundException(
        'Seller profile not found. Complete onboarding first.',
      );
    }
    return {
      userId,
      organizationId: resolved.profile.organizationId,
      sellerProfileId: resolved.profile.id,
    };
  }

  assertCustomerOwns(orgId: string, resourceCustomerOrgId: string) {
    if (orgId !== resourceCustomerOrgId) {
      throw new LogisticsException('UNAUTHORIZED_LOGISTICS_ACCESS');
    }
  }

  assertSellerOwns(orgId: string, resourceSellerOrgId: string) {
    if (orgId !== resourceSellerOrgId) {
      throw new LogisticsException('UNAUTHORIZED_LOGISTICS_ACCESS');
    }
  }
}
