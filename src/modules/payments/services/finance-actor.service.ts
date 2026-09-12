import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';

@Injectable()
export class FinanceActorService {
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
    const profile = await this.prisma.sellerProfile.findFirst({
      where: { userId, deletedAt: null },
    });
    if (!profile) {
      throw new NotFoundException(
        'Seller profile not found. Complete onboarding first.',
      );
    }
    return {
      userId,
      organizationId: profile.organizationId,
      sellerProfileId: profile.id,
    };
  }
}
