import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EntityOwnerType,
  VerificationStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { AdminAuditService } from '../common/admin-audit.service.js';
import {
  AdminExpiringQueryDto,
  AdminListQueryDto,
  AdminReasonDto,
} from '../common/admin-query.dto.js';
import { AdminDocumentsService } from '../documents/admin-documents.service.js';

@Injectable()
export class AdminComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly documents: AdminDocumentsService,
  ) {}

  async list(query: AdminListQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const [sellers, total] = await Promise.all([
      this.prisma.sellerProfile.findMany({
        where: { deletedAt: null },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              verificationStatus: true,
              status: true,
            },
          },
          verification: true,
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.sellerProfile.count({ where: { deletedAt: null } }),
    ]);

    const orgIds = sellers.map((s) => s.organizationId);
    const docs = await this.prisma.document.groupBy({
      by: ['organizationId', 'status'],
      where: {
        deletedAt: null,
        organizationId: { in: orgIds },
      },
      _count: { _all: true },
    });

    const items = sellers.map((seller) => {
      const orgDocs = docs.filter(
        (d) => d.organizationId === seller.organizationId,
      );
      return {
        sellerProfileId: seller.id,
        status: seller.status,
        organization: seller.organization,
        user: seller.user,
        verification: seller.verification,
        documentCounts: orgDocs.map((d) => ({
          status: d.status,
          count: d._count._all,
        })),
      };
    });

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async expiring(query: AdminExpiringQueryDto) {
    const days = Math.max(1, Math.min(365, query.days ?? 30));
    const now = new Date();
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const items = await this.prisma.document.findMany({
      where: {
        deletedAt: null,
        expiresAt: { gte: now, lte: until },
      },
      orderBy: { expiresAt: 'asc' },
      take: 100,
      include: {
        organization: {
          select: { id: true, name: true, legalName: true },
        },
      },
    });

    return {
      days,
      items: items.map((d) => ({
        ...d,
        fileSizeBytes:
          d.fileSizeBytes != null ? d.fileSizeBytes.toString() : null,
      })),
    };
  }

  async entityDetail(entityType: string, entityId: string) {
    const type = entityType.toUpperCase();
    if (type === 'SELLER') {
      const seller = await this.prisma.sellerProfile.findFirst({
        where: { id: entityId, deletedAt: null },
        include: {
          verification: true,
          complianceProfile: true,
          organization: true,
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      });
      if (!seller) throw new NotFoundException('Seller not found');
      const documents = await this.prisma.document.findMany({
        where: {
          deletedAt: null,
          OR: [
            { organizationId: seller.organizationId },
            { ownerType: EntityOwnerType.SELLER, ownerId: seller.id },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      return {
        entityType: 'SELLER',
        seller,
        documents: documents.map((d) => ({
          ...d,
          fileSizeBytes:
            d.fileSizeBytes != null ? d.fileSizeBytes.toString() : null,
        })),
      };
    }

    if (type === 'DOCUMENT') {
      return {
        entityType: 'DOCUMENT',
        document: await this.documents.findOne(entityId),
      };
    }

    throw new BadRequestException('entityType must be SELLER or DOCUMENT');
  }

  async approve(
    entityType: string,
    entityId: string,
    actorUserId: string,
    dto: AdminReasonDto,
  ) {
    const type = entityType.toUpperCase();
    if (type === 'DOCUMENT') {
      return this.documents.approve(entityId, actorUserId, dto);
    }
    if (type === 'SELLER') {
      const seller = await this.prisma.sellerProfile.findFirst({
        where: { id: entityId, deletedAt: null },
      });
      if (!seller) throw new NotFoundException('Seller not found');
      await this.prisma.sellerVerification.upsert({
        where: { sellerProfileId: entityId },
        create: {
          sellerProfileId: entityId,
          overallStatus: VerificationStatus.APPROVED,
          gstVerified: true,
          panVerified: true,
          bankVerified: true,
          locationVerified: true,
          reviewedAt: new Date(),
          notes: dto.notes ?? dto.reason,
        },
        update: {
          overallStatus: VerificationStatus.APPROVED,
          gstVerified: true,
          panVerified: true,
          bankVerified: true,
          locationVerified: true,
          reviewedAt: new Date(),
          notes: dto.notes ?? dto.reason,
        },
      });
      await this.audit.log({
        action: 'COMPLIANCE_SELLER_APPROVED',
        actorUserId,
        organizationId: seller.organizationId,
        entityType: EntityOwnerType.SELLER,
        entityId,
      });
      return this.entityDetail('SELLER', entityId);
    }
    throw new BadRequestException('Unsupported entityType');
  }

  async reject(
    entityType: string,
    entityId: string,
    actorUserId: string,
    dto: AdminReasonDto,
  ) {
    const type = entityType.toUpperCase();
    if (type === 'DOCUMENT') {
      return this.documents.reject(entityId, actorUserId, dto);
    }
    if (type === 'SELLER') {
      const reason = dto.reason ?? dto.notes;
      if (!reason?.trim()) {
        throw new BadRequestException('Rejection reason is required');
      }
      const seller = await this.prisma.sellerProfile.findFirst({
        where: { id: entityId, deletedAt: null },
      });
      if (!seller) throw new NotFoundException('Seller not found');
      await this.prisma.sellerVerification.upsert({
        where: { sellerProfileId: entityId },
        create: {
          sellerProfileId: entityId,
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
      await this.audit.log({
        action: 'COMPLIANCE_SELLER_REJECTED',
        actorUserId,
        organizationId: seller.organizationId,
        entityType: EntityOwnerType.SELLER,
        entityId,
        newData: { reason },
      });
      return this.entityDetail('SELLER', entityId);
    }
    throw new BadRequestException('Unsupported entityType');
  }
}
