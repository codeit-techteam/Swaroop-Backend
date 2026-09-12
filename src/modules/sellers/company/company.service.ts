import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AddressType, Prisma } from '../../../generated/prisma/client.js';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { SellerAuditService } from '../common/seller-audit.service.js';
import {
  SellerContext,
  SellerContextService,
} from '../common/seller-context.service.js';
import { UpdateCompanyDto } from './company.dto.js';

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerContext: SellerContextService,
    private readonly audit: SellerAuditService,
  ) {}

  private async resolveContext(
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

    if (user.roles.includes(RoleCode.SELLER)) {
      return this.sellerContext.requireSeller(user.id);
    }

    if (isAdmin) {
      throw new BadRequestException(
        'sellerProfileId query parameter is required for admin review',
      );
    }

    throw new NotFoundException('Seller profile not found');
  }

  async getCompany(user: AuthenticatedUser, sellerProfileId?: string) {
    const ctx = await this.resolveContext(user, sellerProfileId);
    const organization = await this.prisma.organization.findFirst({
      where: { id: ctx.organizationId, deletedAt: null },
      include: {
        addresses: {
          where: { deletedAt: null, isActive: true },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        },
        bankAccounts: {
          where: { deletedAt: null },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
        sellerProfile: {
          include: { verification: true },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('Company not found');
    }

    return organization;
  }

  async updateCompany(user: AuthenticatedUser, dto: UpdateCompanyDto) {
    const ctx = await this.sellerContext.requireSeller(user.id);

    const verification = await this.prisma.sellerVerification.findUnique({
      where: { sellerProfileId: ctx.sellerProfileId },
    });

    if (verification?.gstVerified && dto.gstin !== undefined) {
      throw new BadRequestException(
        'GSTIN is verified and cannot be changed. Request re-verification first.',
      );
    }
    if (verification?.panVerified && dto.pan !== undefined) {
      throw new BadRequestException(
        'PAN is verified and cannot be changed. Request re-verification first.',
      );
    }

    const previous = await this.getCompany(user);

    const updated = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.update({
        where: { id: ctx.organizationId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.legalName !== undefined ? { legalName: dto.legalName } : {}),
          ...(dto.businessType !== undefined
            ? { businessType: dto.businessType }
            : {}),
          ...(dto.constitutionType !== undefined
            ? { constitutionType: dto.constitutionType }
            : {}),
          ...(dto.industry !== undefined ? { industry: dto.industry } : {}),
          ...(dto.gstin !== undefined ? { gstin: dto.gstin } : {}),
          ...(dto.pan !== undefined ? { pan: dto.pan } : {}),
          ...(dto.cin !== undefined ? { cin: dto.cin } : {}),
          ...(dto.msmeNumber !== undefined
            ? { msmeNumber: dto.msmeNumber }
            : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.website !== undefined ? { website: dto.website } : {}),
        },
      });

      if (dto.address) {
        const existingAddress = await tx.address.findFirst({
          where: {
            organizationId: ctx.organizationId,
            deletedAt: null,
            type: dto.address.type ?? AddressType.REGISTERED,
          },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        });

        const addressData = {
          type: dto.address.type ?? AddressType.REGISTERED,
          label: dto.address.label,
          line1: dto.address.line1,
          line2: dto.address.line2,
          city: dto.address.city,
          state: dto.address.state,
          country: dto.address.country ?? 'IN',
          postalCode: dto.address.postalCode,
          landmark: dto.address.landmark,
          latitude:
            dto.address.latitude !== undefined
              ? new Prisma.Decimal(dto.address.latitude)
              : undefined,
          longitude:
            dto.address.longitude !== undefined
              ? new Prisma.Decimal(dto.address.longitude)
              : undefined,
          isDefault: dto.address.isDefault ?? true,
          isActive: true,
        };

        if (existingAddress) {
          await tx.address.update({
            where: { id: existingAddress.id },
            data: addressData,
          });
        } else {
          await tx.address.create({
            data: {
              organizationId: ctx.organizationId,
              ...addressData,
            },
          });
        }
      }

      if (dto.bankAccount) {
        const existingBank = await tx.bankAccount.findFirst({
          where: {
            organizationId: ctx.organizationId,
            deletedAt: null,
            isPrimary: true,
          },
        });

        const bankData = {
          accountHolder: dto.bankAccount.accountHolder,
          bankName: dto.bankAccount.bankName,
          accountNumber: dto.bankAccount.accountNumber,
          ifsc: dto.bankAccount.ifsc,
          branch: dto.bankAccount.branch,
          isPrimary: dto.bankAccount.isPrimary ?? true,
        };

        if (existingBank) {
          await tx.bankAccount.update({
            where: { id: existingBank.id },
            data: bankData,
          });
        } else {
          await tx.bankAccount.create({
            data: {
              organizationId: ctx.organizationId,
              ...bankData,
            },
          });
        }
      }

      return organization;
    });

    const company = await this.getCompany(user);

    await this.audit.log({
      action: 'SELLER_COMPANY_UPDATED',
      actorUserId: user.id,
      organizationId: ctx.organizationId,
      entityId: updated.id,
      previousData: previous,
      newData: company,
    });

    return company;
  }
}
