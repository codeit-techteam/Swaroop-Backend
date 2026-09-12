import { createHash } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrganizationType,
  SellerStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';

export type SellerContext = {
  userId: string;
  sellerProfileId: string;
  organizationId: string;
  status: SellerStatus;
  organizationName: string;
  verificationStatus: string;
};

@Injectable()
export class SellerContextService {
  constructor(private readonly prisma: PrismaService) {}

  async requireSeller(userId: string): Promise<SellerContext> {
    const profile = await this.prisma.sellerProfile.findFirst({
      where: { userId, deletedAt: null },
      include: { organization: true },
    });

    if (!profile) {
      throw new NotFoundException(
        'Seller profile not found. Complete onboarding first.',
      );
    }

    return {
      userId,
      sellerProfileId: profile.id,
      organizationId: profile.organizationId,
      status: profile.status,
      organizationName: profile.organization.name,
      verificationStatus: profile.organization.verificationStatus,
    };
  }

  async getOrCreateDraftSeller(
    userId: string,
    seed?: {
      companyName?: string;
      email?: string | null;
      phone?: string | null;
    },
  ): Promise<SellerContext> {
    const existing = await this.prisma.sellerProfile.findFirst({
      where: { userId, deletedAt: null },
      include: { organization: true },
    });
    if (existing) {
      return {
        userId,
        sellerProfileId: existing.id,
        organizationId: existing.organizationId,
        status: existing.status,
        organizationName: existing.organization.name,
        verificationStatus: existing.organization.verificationStatus,
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: seed?.companyName?.trim() || 'Seller Organization',
          legalName: seed?.companyName?.trim(),
          type: OrganizationType.SELLER,
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

      const profile = await tx.sellerProfile.create({
        data: {
          userId,
          organizationId: org.id,
          status: SellerStatus.DRAFT,
        },
      });

      await tx.sellerVerification.create({
        data: { sellerProfileId: profile.id },
      });

      await tx.sellerOnboarding.create({
        data: {
          sellerProfileId: profile.id,
          status: 'DRAFT',
          currentStep: 'company',
          completedSteps: [],
        },
      });

      return { org, profile };
    });

    return {
      userId,
      sellerProfileId: result.profile.id,
      organizationId: result.org.id,
      status: result.profile.status,
      organizationName: result.org.name,
      verificationStatus: result.org.verificationStatus,
    };
  }

  assertOwnership(ctx: SellerContext, organizationId: string) {
    if (ctx.organizationId !== organizationId) {
      throw new ForbiddenException('You do not own this resource');
    }
  }
}

export function anonymousBuyerRef(customerOrgId: string): string {
  const hash = createHash('sha256').update(customerOrgId).digest('hex');
  return `BUYER-${hash.slice(0, 8).toUpperCase()}`;
}

export function nextReference(prefix: string): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
  return `${prefix}-${year}-${rand}`;
}
