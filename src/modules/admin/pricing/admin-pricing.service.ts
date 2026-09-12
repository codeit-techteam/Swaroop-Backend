import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityOwnerType, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { AdminAuditService } from '../common/admin-audit.service.js';
import {
  AdminListQueryDto,
  AdminReasonDto,
} from '../common/admin-query.dto.js';

@Injectable()
export class AdminPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async listOffers(query: AdminListQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.OfferWhereInput = { deletedAt: null };
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { referenceNumber: { contains: q, mode: 'insensitive' } },
        { product: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.offer.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        include: {
          organization: {
            select: { id: true, name: true, legalName: true },
          },
          product: { select: { id: true, code: true, name: true } },
          grade: { select: { id: true, code: true, name: true } },
          revisions: {
            orderBy: { createdAt: 'desc' },
            take: 3,
          },
        },
      }),
      this.prisma.offer.count({ where }),
    ]);

    return {
      items: rows.map((o) => ({
        ...o,
        basePrice: o.basePrice.toString(),
        quantity: o.quantity.toString(),
        moq: o.moq?.toString() ?? null,
        priceRevisions: o.revisions.map((r) => ({
          ...r,
          previousPrice: r.previousPrice.toString(),
          proposedPrice: r.proposedPrice.toString(),
        })),
      })),
      meta: paginationMeta(page, limit, total),
    };
  }

  async history(query: AdminListQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.PriceRevisionWhereInput = {};
    if (query.search?.trim()) {
      where.OR = [
        { reason: { contains: query.search.trim(), mode: 'insensitive' } },
        { status: { contains: query.search.trim(), mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.priceRevision.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          offer: {
            select: {
              id: true,
              referenceNumber: true,
              basePrice: true,
              organizationId: true,
            },
          },
        },
      }),
      this.prisma.priceRevision.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        ...r,
        previousPrice: r.previousPrice.toString(),
        proposedPrice: r.proposedPrice.toString(),
        offer: r.offer
          ? {
              ...r.offer,
              basePrice: r.offer.basePrice.toString(),
            }
          : null,
      })),
      meta: paginationMeta(page, limit, total),
    };
  }

  async revisionRequests(query: AdminListQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.PriceRevisionWhereInput = { status: 'PENDING' };

    const [rows, total] = await Promise.all([
      this.prisma.priceRevision.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'asc' },
        include: {
          offer: {
            select: {
              id: true,
              referenceNumber: true,
              basePrice: true,
              organizationId: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.priceRevision.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        ...r,
        previousPrice: r.previousPrice.toString(),
        proposedPrice: r.proposedPrice.toString(),
        offer: r.offer
          ? {
              ...r.offer,
              basePrice: r.offer.basePrice.toString(),
            }
          : null,
      })),
      meta: paginationMeta(page, limit, total),
    };
  }

  async approveRevision(id: string, actorUserId: string, dto: AdminReasonDto) {
    const revision = await this.prisma.priceRevision.findUnique({
      where: { id },
      include: { offer: true },
    });
    if (!revision) throw new NotFoundException('Price revision not found');
    if (revision.status !== 'PENDING') {
      throw new BadRequestException('Revision is not pending');
    }
    if (!revision.offerId || !revision.offer) {
      throw new BadRequestException('Revision is not linked to an offer');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const offer = await tx.offer.update({
        where: { id: revision.offerId! },
        data: { basePrice: revision.proposedPrice },
      });
      const updated = await tx.priceRevision.update({
        where: { id },
        data: {
          status: 'APPLIED',
          metadata: {
            ...((revision.metadata as object) ?? {}),
            approvedBy: actorUserId,
            notes: dto.notes ?? dto.reason,
            appliedAt: new Date().toISOString(),
          },
        },
      });
      return { offer, updated };
    });

    await this.audit.log({
      action: 'PRICE_REVISION_APPROVED',
      actorUserId,
      organizationId: revision.offer.organizationId,
      entityType: EntityOwnerType.OFFER,
      entityId: revision.offerId,
      previousData: { basePrice: revision.previousPrice.toString() },
      newData: {
        basePrice: revision.proposedPrice.toString(),
        revisionId: id,
      },
    });

    return {
      revision: {
        ...result.updated,
        previousPrice: result.updated.previousPrice.toString(),
        proposedPrice: result.updated.proposedPrice.toString(),
      },
      offer: {
        id: result.offer.id,
        basePrice: result.offer.basePrice.toString(),
      },
    };
  }

  async rejectRevision(id: string, actorUserId: string, dto: AdminReasonDto) {
    const revision = await this.prisma.priceRevision.findUnique({
      where: { id },
      include: { offer: true },
    });
    if (!revision) throw new NotFoundException('Price revision not found');
    if (revision.status !== 'PENDING') {
      throw new BadRequestException('Revision is not pending');
    }
    const reason = dto.reason ?? dto.notes;
    if (!reason?.trim()) {
      throw new BadRequestException('Rejection reason is required');
    }

    const updated = await this.prisma.priceRevision.update({
      where: { id },
      data: {
        status: 'REJECTED',
        metadata: {
          ...((revision.metadata as object) ?? {}),
          rejectedBy: actorUserId,
          reason,
          rejectedAt: new Date().toISOString(),
        },
      },
    });

    await this.audit.log({
      action: 'PRICE_REVISION_REJECTED',
      actorUserId,
      organizationId: revision.offer?.organizationId,
      entityType: EntityOwnerType.OFFER,
      entityId: revision.offerId ?? undefined,
      newData: { revisionId: id, reason },
    });

    return {
      ...updated,
      previousPrice: updated.previousPrice.toString(),
      proposedPrice: updated.proposedPrice.toString(),
    };
  }
}
