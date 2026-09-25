import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EntityOwnerType,
  OfferStatus,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { AdminAuditService } from '../common/admin-audit.service.js';
import type {
  AdminOfferActionDto,
  AdminOffersQueryDto,
} from './admin-offers.dto.js';

const offerInclude = {
  organization: {
    select: { id: true, name: true, legalName: true, code: true },
  },
  product: { select: { id: true, code: true, name: true } },
  grade: {
    select: { id: true, code: true, name: true, displayName: true },
  },
  warehouse: {
    select: { id: true, code: true, name: true, city: true, state: true },
  },
  inventory: {
    select: { id: true, availableQty: true, reservedQty: true },
  },
  _count: {
    select: { purchaseRequestItems: true },
  },
} satisfies Prisma.OfferInclude;

function serializeOffer(offer: {
  basePrice: { toString(): string };
  quantity: { toString(): string };
  moq: { toString(): string } | null;
  [key: string]: unknown;
}) {
  return {
    ...offer,
    basePrice: offer.basePrice.toString(),
    quantity: offer.quantity.toString(),
    moq: offer.moq?.toString() ?? null,
  };
}

@Injectable()
export class AdminOffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminOffersQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.OfferWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.organizationId) where.organizationId = query.organizationId;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { referenceNumber: { contains: q, mode: 'insensitive' } },
        { product: { name: { contains: q, mode: 'insensitive' } } },
        { grade: { code: { contains: q, mode: 'insensitive' } } },
        { grade: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.offer.findMany({
        where,
        include: offerInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.offer.count({ where }),
    ]);

    return {
      items: rows.map((o) => serializeOffer(o)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(id: string) {
    const offer = await this.prisma.offer.findFirst({
      where: { id, deletedAt: null },
      include: offerInclude,
    });
    if (!offer) throw new NotFoundException('Offer not found');
    return serializeOffer(offer);
  }

  private async setStatus(
    id: string,
    status: OfferStatus,
    actorUserId: string,
    action: string,
    dto?: AdminOfferActionDto,
  ) {
    const existing = await this.prisma.offer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Offer not found');

    if (
      status === OfferStatus.REJECTED &&
      !(dto?.reason ?? dto?.notes)?.trim()
    ) {
      throw new BadRequestException('Rejection reason is required');
    }

    const offer = await this.prisma.offer.update({
      where: { id },
      data: {
        status,
        metadata: {
          ...((existing.metadata as object) ?? {}),
          adminAction: {
            action,
            reason: dto?.reason ?? dto?.notes,
            at: new Date().toISOString(),
          },
        },
      },
      include: offerInclude,
    });

    await this.audit.log({
      action,
      actorUserId,
      organizationId: existing.organizationId,
      entityType: EntityOwnerType.OFFER,
      entityId: id,
      previousData: { status: existing.status },
      newData: { status, reason: dto?.reason ?? dto?.notes },
    });

    return serializeOffer(offer);
  }

  approve(id: string, actorUserId: string, dto: AdminOfferActionDto) {
    return this.setStatus(
      id,
      OfferStatus.ACTIVE,
      actorUserId,
      'OFFER_APPROVED',
      dto,
    );
  }

  reject(id: string, actorUserId: string, dto: AdminOfferActionDto) {
    return this.setStatus(
      id,
      OfferStatus.REJECTED,
      actorUserId,
      'OFFER_REJECTED',
      dto,
    );
  }

  suspend(id: string, actorUserId: string, dto: AdminOfferActionDto) {
    return this.setStatus(
      id,
      OfferStatus.PAUSED,
      actorUserId,
      'OFFER_SUSPENDED',
      dto,
    );
  }

  async summary() {
    const now = new Date();
    const expiringUntil = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const base = { deletedAt: null };

    const [
      active,
      draft,
      paused,
      expired,
      pendingReview,
      rejected,
      closed,
      expiringSoon,
      soldOut,
      total,
    ] = await Promise.all([
      this.prisma.offer.count({ where: { ...base, status: OfferStatus.ACTIVE } }),
      this.prisma.offer.count({ where: { ...base, status: OfferStatus.DRAFT } }),
      this.prisma.offer.count({ where: { ...base, status: OfferStatus.PAUSED } }),
      this.prisma.offer.count({ where: { ...base, status: OfferStatus.EXPIRED } }),
      this.prisma.offer.count({
        where: { ...base, status: OfferStatus.PENDING_REVIEW },
      }),
      this.prisma.offer.count({
        where: { ...base, status: OfferStatus.REJECTED },
      }),
      this.prisma.offer.count({ where: { ...base, status: OfferStatus.CLOSED } }),
      this.prisma.offer.count({
        where: {
          ...base,
          status: OfferStatus.ACTIVE,
          validUntil: { gt: now, lte: expiringUntil },
        },
      }),
      this.prisma.offer.count({
        where: {
          ...base,
          status: OfferStatus.ACTIVE,
          quantity: { lte: 0 },
        },
      }),
      this.prisma.offer.count({ where: base }),
    ]);

    return {
      total,
      active,
      draft,
      paused,
      expired,
      pendingReview,
      rejected,
      closed,
      expiringSoon,
      soldOut,
    };
  }

  async history(id: string) {
    await this.findOne(id);
    return this.prisma.auditLog.findMany({
      where: {
        entityType: EntityOwnerType.OFFER,
        entityId: id,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        action: true,
        actorUserId: true,
        previousData: true,
        newData: true,
        metadata: true,
        createdAt: true,
      },
    });
  }
}
