import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  AddressType,
  DocumentStatus,
  EntityOwnerType,
} from '../../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  SellerContext,
  SellerContextService,
} from '../common/seller-context.service.js';
import { SellerAuditService } from '../common/seller-audit.service.js';
import { UpdateSellerProfileDto } from './profile.dto.js';
import { buildSellerProfileSummary } from './seller-profile.summary.js';

const ADDRESS_PRIORITY: AddressType[] = [
  AddressType.REGISTERED,
  AddressType.BILLING,
  AddressType.WAREHOUSE,
  AddressType.SHIPPING,
  AddressType.OTHER,
];

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerContext: SellerContextService,
    private readonly audit: SellerAuditService,
  ) {}

  async resolveContext(
    user: AuthenticatedUser,
    sellerProfileId?: string,
  ): Promise<SellerContext> {
    const isAdmin =
      user.roles.includes(RoleCode.ADMIN) ||
      user.roles.includes(RoleCode.SUPER_ADMIN);

    if (sellerProfileId) {
      if (!isAdmin) {
        throw new BadRequestException(
          'sellerProfileId is only allowed for admin review',
        );
      }
      const profile = await this.prisma.sellerProfile.findFirst({
        where: { id: sellerProfileId, deletedAt: null },
        include: { organization: true },
      });
      if (!profile) {
        throw new NotFoundException('Seller profile not found');
      }
      return {
        userId: profile.userId,
        sellerProfileId: profile.id,
        organizationId: profile.organizationId,
        status: profile.status,
        organizationName: profile.organization.name,
        verificationStatus: profile.organization.verificationStatus,
      };
    }

    if (
      user.roles.includes(RoleCode.SELLER) ||
      user.roles.includes(RoleCode.SELLER_MANAGER)
    ) {
      return this.sellerContext.requireSeller(user.id);
    }

    if (isAdmin) {
      throw new BadRequestException(
        'sellerProfileId query parameter is required for admin review',
      );
    }

    throw new NotFoundException('Seller profile not found');
  }

  async getProfile(user: AuthenticatedUser, sellerProfileId?: string) {
    const ctx = await this.resolveContext(user, sellerProfileId);
    const profile = await this.prisma.sellerProfile.findFirst({
      where: { id: ctx.sellerProfileId, deletedAt: null },
      include: {
        organization: true,
        verification: true,
        complianceProfile: true,
        onboarding: true,
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Seller profile not found');
    }

    const [managers, addresses, bank, kycDocumentsCount] = await Promise.all([
      this.prisma.sellerManagerAssignment.findMany({
        where: { sellerProfileId: profile.id, status: 'ACTIVE' },
        orderBy: [{ isPrimary: 'desc' }, { assignedAt: 'asc' }],
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phone: true,
              firstName: true,
              lastName: true,
              displayName: true,
              status: true,
              loginId: true,
            },
          },
        },
      }),
      this.prisma.address.findMany({
        where: {
          organizationId: profile.organizationId,
          deletedAt: null,
          isActive: true,
        },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
      this.prisma.bankAccount.findFirst({
        where: { organizationId: profile.organizationId, deletedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      }),
      this.prisma.document.count({
        where: {
          deletedAt: null,
          ownerType: EntityOwnerType.SELLER,
          ownerId: profile.id,
          status: {
            in: [
              DocumentStatus.UPLOADED,
              DocumentStatus.UNDER_REVIEW,
              DocumentStatus.VERIFIED,
            ],
          },
        },
      }),
    ]);

    const address =
      ADDRESS_PRIORITY.map((type) =>
        addresses.find((row) => row.type === type),
      ).find(Boolean) ?? null;

    const summary = buildSellerProfileSummary(profile, {
      address: address
        ? {
            line1: address.formattedAddress || address.line1,
            city: address.city,
            state: address.state,
            postalCode: address.postalCode,
            type: address.type,
          }
        : null,
      bank: bank
        ? {
            accountHolder: bank.accountHolder,
            bankName: bank.bankName,
            accountNumber: bank.accountNumber,
            ifsc: bank.ifsc,
            branch: bank.branch,
            verificationStatus: bank.verificationStatus,
          }
        : null,
      kycDocumentsCount,
    });

    return {
      ...profile,
      summary,
      accountManagers: managers.map((row) => ({
        id: row.user.id,
        assignmentId: row.id,
        name:
          row.user.displayName ||
          [row.user.firstName, row.user.lastName].filter(Boolean).join(' '),
        email: row.user.email,
        phone: row.user.phone,
        loginId: row.user.loginId,
        role: 'SELLER_MANAGER',
        title: row.title,
        status: row.user.status,
        isPrimary: row.isPrimary,
        seller: profile.organization.name,
      })),
    };
  }

  async updateProfile(user: AuthenticatedUser, dto: UpdateSellerProfileDto) {
    const ctx = await this.sellerContext.requireSeller(user.id);
    const previous = await this.prisma.sellerProfile.findFirst({
      where: { id: ctx.sellerProfileId, deletedAt: null },
    });
    if (!previous) {
      throw new NotFoundException('Seller profile not found');
    }

    const updated = await this.prisma.sellerProfile.update({
      where: { id: ctx.sellerProfileId },
      data: {
        ...(dto.sellerType !== undefined ? { sellerType: dto.sellerType } : {}),
        ...(dto.metadata !== undefined
          ? { metadata: dto.metadata as object }
          : {}),
      },
      include: {
        organization: true,
        verification: true,
        complianceProfile: true,
        onboarding: true,
      },
    });

    await this.audit.log({
      action: 'SELLER_PROFILE_UPDATED',
      actorUserId: user.id,
      organizationId: ctx.organizationId,
      entityId: ctx.sellerProfileId,
      previousData: previous,
      newData: updated,
    });

    return updated;
  }

  async getStatus(user: AuthenticatedUser, sellerProfileId?: string) {
    const ctx = await this.resolveContext(user, sellerProfileId);
    const profile = await this.prisma.sellerProfile.findFirst({
      where: { id: ctx.sellerProfileId, deletedAt: null },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            status: true,
            verificationStatus: true,
            verifiedAt: true,
          },
        },
        verification: true,
        onboarding: {
          select: {
            id: true,
            status: true,
            currentStep: true,
            completedSteps: true,
            submittedAt: true,
            reviewedAt: true,
            rejectedReason: true,
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Seller profile not found');
    }

    return {
      sellerProfileId: profile.id,
      status: profile.status,
      sellerType: profile.sellerType,
      approvedAt: profile.approvedAt,
      organization: profile.organization,
      verification: profile.verification,
      onboarding: profile.onboarding,
    };
  }
}
