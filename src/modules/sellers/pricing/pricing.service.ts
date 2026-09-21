import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CurrencyCode,
  EntityOwnerType,
  OfferStatus,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { SellerAuditService } from '../common/seller-audit.service.js';
import {
  SellerContext,
  SellerContextService,
} from '../common/seller-context.service.js';
import type {
  CreatePriceTierDto,
  PricingQueryDto,
  SetPriceTierActiveDto,
  UpdatePriceTierDto,
} from './pricing.dto.js';
import { isSellerCreditPriceTier } from '../../payments/common/platform-credit.js';

const tierInclude = {
  offer: {
    select: {
      id: true,
      referenceNumber: true,
      status: true,
      organizationId: true,
      basePrice: true,
      currency: true,
      productId: true,
      gradeId: true,
    },
  },
} satisfies Prisma.OfferPriceTierInclude;

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerContext: SellerContextService,
    private readonly audit: SellerAuditService,
  ) {}

  private async ctx(userId: string) {
    return this.sellerContext.requireSeller(userId);
  }

  private async assertOwnedTier(ctx: SellerContext, id: string) {
    const tier = await this.prisma.offerPriceTier.findFirst({
      where: {
        id,
        offer: {
          organizationId: ctx.organizationId,
          deletedAt: null,
        },
      },
      include: tierInclude,
    });
    if (!tier) throw new NotFoundException('Price tier not found');
    return tier;
  }

  async findAll(userId: string, query: PricingQueryDto) {
    const ctx = await this.ctx(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.OfferPriceTierWhereInput = {
      offer: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(query.offerId ? { id: query.offerId } : {}),
      },
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.offerPriceTier.count({ where }),
      this.prisma.offerPriceTier.findMany({
        where,
        include: tierInclude,
        orderBy: [{ offerId: 'asc' }, { minQty: 'asc' }],
        skip,
        take,
      }),
    ]);

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findOne(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    return this.assertOwnedTier(ctx, id);
  }

  async create(userId: string, dto: CreatePriceTierDto) {
    const ctx = await this.ctx(userId);
    const offer = await this.prisma.offer.findFirst({
      where: {
        id: dto.offerId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (isSellerCreditPriceTier(dto.paymentMethod)) {
      throw new BadRequestException(
        'Seller cannot set credit-specific prices. CREDIT is a PetroTrade platform payment option.',
      );
    }

    const tier = await this.prisma.offerPriceTier.create({
      data: {
        offerId: dto.offerId,
        minQty: dto.minQty,
        maxQty: dto.maxQty,
        price: dto.price,
        currency: dto.currency ?? offer.currency ?? CurrencyCode.INR,
        paymentMethod: dto.paymentMethod,
      },
      include: tierInclude,
    });

    await this.audit.log({
      action: 'PRICE_TIER_CREATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.OFFER,
      entityId: offer.id,
      newData: { tierId: tier.id, price: dto.price },
    });

    return tier;
  }

  async update(userId: string, id: string, dto: UpdatePriceTierDto) {
    const ctx = await this.ctx(userId);
    const existing = await this.assertOwnedTier(ctx, id);
    if (isSellerCreditPriceTier(dto.paymentMethod)) {
      throw new BadRequestException(
        'Seller cannot set credit-specific prices. CREDIT is a PetroTrade platform payment option.',
      );
    }
    const offerIsActive = existing.offer.status === OfferStatus.ACTIVE;
    const applyToTier = dto.applyToTier !== false;
    const priceChanging =
      dto.price != null && Number(dto.price) !== Number(existing.price);

    const result = await this.prisma.$transaction(async (tx) => {
      let revision = null;
      if (offerIsActive && priceChanging) {
        revision = await tx.priceRevision.create({
          data: {
            offerId: existing.offerId,
            previousPrice: existing.price,
            proposedPrice: dto.price!,
            currency: dto.currency ?? existing.currency,
            reason: dto.revisionReason ?? 'Seller price tier update',
            status: applyToTier ? 'APPLIED' : 'PENDING',
            metadata: {
              tierId: existing.id,
              minQty: dto.minQty ?? existing.minQty,
              maxQty: dto.maxQty ?? existing.maxQty,
            } as Prisma.InputJsonValue,
          },
        });
      }

      let tier = existing;
      if (applyToTier || !offerIsActive) {
        tier = await tx.offerPriceTier.update({
          where: { id },
          data: {
            minQty: dto.minQty,
            maxQty: dto.maxQty,
            price: dto.price,
            currency: dto.currency,
            paymentMethod: dto.paymentMethod,
          },
          include: tierInclude,
        });
      }

      return { tier, revision };
    });

    await this.audit.log({
      action: offerIsActive ? 'PRICE_TIER_REVISED' : 'PRICE_TIER_UPDATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.OFFER,
      entityId: existing.offerId,
      previousData: { price: existing.price },
      newData: {
        price: dto.price ?? existing.price,
        revisionId: result.revision?.id,
      },
    });

    return result;
  }

  async setActive(userId: string, id: string, dto: SetPriceTierActiveDto) {
    const ctx = await this.ctx(userId);
    const existing = await this.assertOwnedTier(ctx, id);

    const offer = await this.prisma.offer.findFirst({
      where: { id: existing.offerId, deletedAt: null },
    });
    if (!offer) throw new NotFoundException('Offer not found');

    const meta =
      offer.metadata && typeof offer.metadata === 'object'
        ? { ...(offer.metadata as Record<string, unknown>) }
        : {};
    const inactiveTiers = new Set<string>(
      Array.isArray(meta.inactivePriceTier)
        ? (meta.inactivePriceTier as string[])
        : [],
    );

    if (dto.active) inactiveTiers.delete(id);
    else inactiveTiers.add(id);

    const updatedOffer = await this.prisma.offer.update({
      where: { id: offer.id },
      data: {
        metadata: {
          ...meta,
          inactivePriceTier: [...inactiveTiers],
        } as Prisma.InputJsonValue,
      },
    });

    await this.audit.log({
      action: dto.active ? 'PRICE_TIER_ACTIVATED' : 'PRICE_TIER_DEACTIVATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.OFFER,
      entityId: offer.id,
      newData: { tierId: id, active: dto.active },
    });

    return {
      tier: existing,
      active: dto.active,
      offerMetadata: updatedOffer.metadata,
    };
  }
}
