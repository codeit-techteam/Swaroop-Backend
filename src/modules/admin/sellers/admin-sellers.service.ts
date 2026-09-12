import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EntityOwnerType,
  OrganizationStatus,
  Prisma,
  SellerOnboardingStatus,
  SellerStatus,
  UserStatus,
  VerificationStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { NotificationService } from '../../notifications/notification.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { AdminAuditService } from '../common/admin-audit.service.js';
import type {
  AdminSellerActionDto,
  AdminSellersQueryDto,
} from './admin-sellers.dto.js';

const sellerInclude = {
  user: {
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      displayName: true,
      status: true,
    },
  },
  organization: {
    select: {
      id: true,
      name: true,
      legalName: true,
      code: true,
      status: true,
      verificationStatus: true,
      gstin: true,
      pan: true,
    },
  },
  onboarding: {
    select: {
      id: true,
      status: true,
      currentStep: true,
      submittedAt: true,
      reviewedAt: true,
    },
  },
  verification: true,
  _count: {
    select: {
      products: true,
      offers: true,
      inventory: true,
      orders: true,
    },
  },
} satisfies Prisma.SellerProfileInclude;

@Injectable()
export class AdminSellersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly notifications: NotificationService,
  ) {}

  async list(query: AdminSellersQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.SellerProfileWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { organization: { name: { contains: q, mode: 'insensitive' } } },
        { organization: { legalName: { contains: q, mode: 'insensitive' } } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
        { user: { phone: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.sellerProfile.findMany({
        where,
        include: sellerInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.sellerProfile.count({ where }),
    ]);

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findOne(id: string) {
    const seller = await this.prisma.sellerProfile.findFirst({
      where: { id, deletedAt: null },
      include: sellerInclude,
    });
    if (!seller) throw new NotFoundException('Seller not found');
    return seller;
  }

  async approve(id: string, actorUserId: string, dto: AdminSellerActionDto) {
    const seller = await this.findOne(id);
    if (seller.status === SellerStatus.APPROVED) {
      throw new BadRequestException('Seller is already approved');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const profile = await tx.sellerProfile.update({
        where: { id },
        data: {
          status: SellerStatus.APPROVED,
          approvedAt: new Date(),
          verificationNotes:
            dto.notes ?? dto.reason ?? seller.verificationNotes,
        },
        include: sellerInclude,
      });

      if (profile.onboarding) {
        await tx.sellerOnboarding.update({
          where: { sellerProfileId: id },
          data: {
            status: SellerOnboardingStatus.APPROVED,
            reviewedAt: new Date(),
            reviewNotes: dto.notes ?? dto.reason,
          },
        });
      }

      await tx.sellerVerification.upsert({
        where: { sellerProfileId: id },
        create: {
          sellerProfileId: id,
          overallStatus: VerificationStatus.APPROVED,
          reviewedAt: new Date(),
          notes: dto.notes ?? dto.reason,
        },
        update: {
          overallStatus: VerificationStatus.APPROVED,
          reviewedAt: new Date(),
          notes: dto.notes ?? dto.reason,
        },
      });

      await tx.organization.update({
        where: { id: seller.organizationId },
        data: {
          status: OrganizationStatus.ACTIVE,
          verificationStatus: VerificationStatus.APPROVED,
          verifiedAt: new Date(),
        },
      });

      await tx.user.update({
        where: { id: seller.userId },
        data: { status: UserStatus.ACTIVE },
      });

      return profile;
    });

    await this.audit.log({
      action: 'SELLER_APPROVED',
      actorUserId,
      organizationId: seller.organizationId,
      entityType: EntityOwnerType.SELLER,
      entityId: id,
      previousData: { status: seller.status },
      newData: { status: SellerStatus.APPROVED },
    });

    await this.notifications.create({
      userId: seller.userId,
      organizationId: seller.organizationId,
      title: 'Seller account approved',
      body: 'Your seller account has been approved. You can now list products and offers.',
      entityType: EntityOwnerType.SELLER,
      entityId: id,
    });

    return this.findOne(id).catch(() => updated);
  }

  async reject(id: string, actorUserId: string, dto: AdminSellerActionDto) {
    const seller = await this.findOne(id);
    const reason = dto.reason ?? dto.notes;
    if (!reason?.trim()) {
      throw new BadRequestException('Rejection reason is required');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.sellerProfile.update({
        where: { id },
        data: {
          status: SellerStatus.REJECTED,
          verificationNotes: reason,
        },
      });

      if (seller.onboarding) {
        await tx.sellerOnboarding.update({
          where: { sellerProfileId: id },
          data: {
            status: SellerOnboardingStatus.REJECTED,
            reviewedAt: new Date(),
            reviewNotes: reason,
          },
        });
      }

      await tx.sellerVerification.upsert({
        where: { sellerProfileId: id },
        create: {
          sellerProfileId: id,
          overallStatus: VerificationStatus.REJECTED,
          reviewedAt: new Date(),
          notes: reason,
        },
        update: {
          overallStatus: VerificationStatus.REJECTED,
          reviewedAt: new Date(),
          notes: reason,
        },
      });

      await tx.organization.update({
        where: { id: seller.organizationId },
        data: {
          status: OrganizationStatus.REJECTED,
          verificationStatus: VerificationStatus.REJECTED,
        },
      });
    });

    await this.audit.log({
      action: 'SELLER_REJECTED',
      actorUserId,
      organizationId: seller.organizationId,
      entityType: EntityOwnerType.SELLER,
      entityId: id,
      previousData: { status: seller.status },
      newData: { status: SellerStatus.REJECTED, reason },
    });

    await this.notifications.create({
      userId: seller.userId,
      organizationId: seller.organizationId,
      title: 'Seller account rejected',
      body: reason,
      entityType: EntityOwnerType.SELLER,
      entityId: id,
    });

    return this.findOne(id);
  }

  async suspend(id: string, actorUserId: string, dto: AdminSellerActionDto) {
    const seller = await this.findOne(id);
    const reason = dto.reason ?? dto.notes ?? 'Suspended by admin';

    await this.prisma.$transaction(async (tx) => {
      await tx.sellerProfile.update({
        where: { id },
        data: {
          status: SellerStatus.SUSPENDED,
          verificationNotes: reason,
        },
      });
      await tx.organization.update({
        where: { id: seller.organizationId },
        data: { status: OrganizationStatus.SUSPENDED },
      });
      await tx.user.update({
        where: { id: seller.userId },
        data: { status: UserStatus.SUSPENDED },
      });
    });

    await this.audit.log({
      action: 'SELLER_SUSPENDED',
      actorUserId,
      organizationId: seller.organizationId,
      entityType: EntityOwnerType.SELLER,
      entityId: id,
      previousData: { status: seller.status },
      newData: { status: SellerStatus.SUSPENDED, reason },
    });

    await this.notifications.create({
      userId: seller.userId,
      organizationId: seller.organizationId,
      title: 'Seller account suspended',
      body: reason,
      entityType: EntityOwnerType.SELLER,
      entityId: id,
    });

    return this.findOne(id);
  }
}
