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
  SellerStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { SellerAuditService } from '../common/seller-audit.service.js';
import {
  nextReference,
  SellerContext,
  SellerContextService,
} from '../common/seller-context.service.js';
import type {
  CreateOfferDto,
  OfferQueryDto,
  UpdateOfferDto,
} from './offers.dto.js';
import {
  hasSellerCreditPricing,
  isSellerCreditPriceTier,
  sanitizeSellerPaymentTerms,
} from '../../payments/common/platform-credit.js';

const offerInclude = {
  product: { select: { id: true, code: true, name: true, gradeId: true } },
  grade: {
    select: { id: true, code: true, name: true, displayName: true },
  },
  priceTiers: { orderBy: { minQty: 'asc' as const } },
  warehouse: { select: { id: true, code: true, name: true } },
  inventory: {
    select: { id: true, availableQty: true, warehouseId: true },
  },
} satisfies Prisma.OfferInclude;

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerContext: SellerContextService,
    private readonly audit: SellerAuditService,
  ) {}

  private async ctx(userId: string) {
    return this.sellerContext.requireSeller(userId);
  }

  private async assertOwned(ctx: SellerContext, id: string) {
    const offer = await this.prisma.offer.findFirst({
      where: { id, organizationId: ctx.organizationId, deletedAt: null },
      include: offerInclude,
    });
    if (!offer) throw new NotFoundException('Offer not found');
    return offer;
  }

  private async resolveProduct(
    ctx: SellerContext,
    productId: string,
    gradeId?: string,
  ) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
    });
    if (!product) {
      throw new BadRequestException('Product not found for this seller');
    }
    if (gradeId && gradeId !== product.gradeId) {
      throw new BadRequestException(
        'gradeId must match the product grade; grade is copied from product',
      );
    }
    return product;
  }

  private commercialPriceTiers(
    tiers?: CreateOfferDto['priceTiers'],
  ): NonNullable<CreateOfferDto['priceTiers']> | undefined {
    if (!tiers?.length) return undefined;
    const commercial = tiers.filter(
      (tier) => !isSellerCreditPriceTier(tier.paymentMethod),
    );
    if (commercial.length !== tiers.length) {
      throw new BadRequestException(
        'Seller cannot submit credit pricing. CREDIT is a PetroTrade platform payment option.',
      );
    }
    return commercial;
  }

  async create(userId: string, dto: CreateOfferDto) {
    const ctx = await this.ctx(userId);
    const product = await this.resolveProduct(ctx, dto.productId, dto.gradeId);

    if (dto.inventoryId) {
      const inv = await this.prisma.inventory.findFirst({
        where: {
          id: dto.inventoryId,
          organizationId: ctx.organizationId,
          deletedAt: null,
          productId: product.id,
        },
      });
      if (!inv) {
        throw new BadRequestException(
          'Inventory not found for this product/seller',
        );
      }
    }

    const priceTiers = this.commercialPriceTiers(dto.priceTiers);
    if (hasSellerCreditPricing(dto.paymentTerms)) {
      throw new BadRequestException(
        'Seller cannot submit credit pricing. CREDIT is owned by PetroTrade Credit Management.',
      );
    }

    const offer = await this.prisma.offer.create({
      data: {
        referenceNumber: nextReference('OFFER'),
        organizationId: ctx.organizationId,
        sellerProfileId: ctx.sellerProfileId,
        productId: product.id,
        gradeId: product.gradeId,
        inventoryId: dto.inventoryId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
        moq: dto.moq,
        unit: dto.unit ?? product.unit ?? 'MT',
        basePrice: dto.basePrice,
        currency: dto.currency ?? CurrencyCode.INR,
        pricingBasis: dto.pricingBasis,
        paymentTerms: sanitizeSellerPaymentTerms(dto.paymentTerms) as
          Prisma.InputJsonValue | undefined,
        deliveryTerms: dto.deliveryTerms,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        status: OfferStatus.DRAFT,
        visibility: dto.visibility ?? 'MARKETPLACE',
        createdById: userId,
        metadata: dto.metadata as Prisma.InputJsonValue,
        priceTiers: priceTiers?.length
          ? {
              create: priceTiers.map((t) => ({
                minQty: t.minQty,
                maxQty: t.maxQty,
                price: t.price,
                currency: t.currency ?? dto.currency ?? CurrencyCode.INR,
                paymentMethod: isSellerCreditPriceTier(t.paymentMethod)
                  ? undefined
                  : t.paymentMethod,
              })),
            }
          : undefined,
      },
      include: offerInclude,
    });

    await this.audit.log({
      action: 'OFFER_CREATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.OFFER,
      entityId: offer.id,
      newData: {
        referenceNumber: offer.referenceNumber,
        status: offer.status,
      },
    });

    return offer;
  }

  async findAll(userId: string, query: OfferQueryDto) {
    const ctx = await this.ctx(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.OfferWhereInput = {
      organizationId: ctx.organizationId,
      deletedAt: null,
    };
    if (query.status) where.status = query.status;
    if (query.productId) where.productId = query.productId;
    if (query.gradeId) where.gradeId = query.gradeId;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { referenceNumber: { contains: q, mode: 'insensitive' } },
        { product: { name: { contains: q, mode: 'insensitive' } } },
        { product: { code: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.offer.count({ where }),
      this.prisma.offer.findMany({
        where,
        include: offerInclude,
        orderBy: {
          createdAt: query.sortOrder === 'asc' ? 'asc' : 'desc',
        },
        skip,
        take,
      }),
    ]);

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findOne(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    return this.assertOwned(ctx, id);
  }

  async update(userId: string, id: string, dto: UpdateOfferDto) {
    const ctx = await this.ctx(userId);
    const existing = await this.assertOwned(ctx, id);

    if (
      existing.status === OfferStatus.ACTIVE ||
      existing.status === OfferStatus.EXPIRED
    ) {
      throw new BadRequestException(
        `Cannot update offer in status ${existing.status}; pause or revise pricing instead`,
      );
    }

    let gradeId = existing.gradeId;
    let productId = existing.productId;
    if (dto.productId) {
      const product = await this.resolveProduct(
        ctx,
        dto.productId,
        dto.gradeId,
      );
      productId = product.id;
      gradeId = product.gradeId;
    } else if (dto.gradeId && dto.gradeId !== existing.gradeId) {
      throw new BadRequestException(
        'gradeId must match the product grade; change product instead',
      );
    }

    if (dto.priceTiers) {
      this.commercialPriceTiers(dto.priceTiers);
    }
    if (hasSellerCreditPricing(dto.paymentTerms)) {
      throw new BadRequestException(
        'Seller cannot submit credit pricing. CREDIT is owned by PetroTrade Credit Management.',
      );
    }

    const offer = await this.prisma.$transaction(async (tx) => {
      if (dto.priceTiers) {
        await tx.offerPriceTier.deleteMany({ where: { offerId: id } });
        if (dto.priceTiers.length) {
          await tx.offerPriceTier.createMany({
            data: dto.priceTiers.map((t) => ({
              offerId: id,
              minQty: t.minQty,
              maxQty: t.maxQty,
              price: t.price,
              currency: t.currency ?? dto.currency ?? existing.currency,
              paymentMethod: isSellerCreditPriceTier(t.paymentMethod)
                ? null
                : t.paymentMethod,
            })),
          });
        }
      }

      return tx.offer.update({
        where: { id },
        data: {
          productId,
          gradeId,
          inventoryId: dto.inventoryId,
          warehouseId: dto.warehouseId,
          quantity: dto.quantity,
          moq: dto.moq,
          unit: dto.unit,
          basePrice: dto.basePrice,
          currency: dto.currency,
          pricingBasis: dto.pricingBasis,
          paymentTerms:
            dto.paymentTerms === undefined
              ? undefined
              : (sanitizeSellerPaymentTerms(dto.paymentTerms) as
                  Prisma.InputJsonValue | undefined),
          deliveryTerms: dto.deliveryTerms,
          validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
          visibility: dto.visibility,
          metadata:
            dto.metadata === undefined
              ? undefined
              : (dto.metadata as Prisma.InputJsonValue),
        },
        include: offerInclude,
      });
    });

    await this.audit.log({
      action: 'OFFER_UPDATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.OFFER,
      entityId: id,
      previousData: { status: existing.status, basePrice: existing.basePrice },
      newData: { status: offer.status, basePrice: offer.basePrice },
    });

    return offer;
  }

  async activate(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    const offer = await this.assertOwned(ctx, id);
    if (ctx.status !== SellerStatus.APPROVED) {
      throw new BadRequestException(
        'Only APPROVED sellers can activate offers',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      let current = offer;
      if (current.status === OfferStatus.DRAFT) {
        current = await tx.offer.update({
          where: { id },
          data: { status: OfferStatus.PENDING_REVIEW },
          include: offerInclude,
        });
      }
      if (current.status !== OfferStatus.PENDING_REVIEW) {
        throw new BadRequestException(
          `Cannot activate offer in status ${current.status}`,
        );
      }
      return tx.offer.update({
        where: { id },
        data: { status: OfferStatus.ACTIVE },
        include: offerInclude,
      });
    });

    await this.audit.log({
      action: 'OFFER_ACTIVATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.OFFER,
      entityId: id,
      previousData: { status: offer.status },
      newData: { status: updated.status },
    });

    return updated;
  }

  async pause(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    const offer = await this.assertOwned(ctx, id);
    if (
      offer.status !== OfferStatus.ACTIVE &&
      offer.status !== OfferStatus.PENDING_REVIEW
    ) {
      throw new BadRequestException(
        `Cannot pause offer in status ${offer.status}`,
      );
    }
    const updated = await this.prisma.offer.update({
      where: { id },
      data: { status: OfferStatus.PAUSED },
      include: offerInclude,
    });

    await this.audit.log({
      action: 'OFFER_PAUSED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.OFFER,
      entityId: id,
      previousData: { status: offer.status },
      newData: { status: updated.status },
    });

    return updated;
  }

  async expire(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    const offer = await this.assertOwned(ctx, id);
    const updated = await this.prisma.offer.update({
      where: { id },
      data: { status: OfferStatus.EXPIRED },
      include: offerInclude,
    });

    await this.audit.log({
      action: 'OFFER_EXPIRED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.OFFER,
      entityId: id,
      previousData: { status: offer.status },
      newData: { status: updated.status },
    });

    return updated;
  }

  async softDelete(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    await this.assertOwned(ctx, id);
    const updated = await this.prisma.offer.update({
      where: { id },
      data: { deletedAt: new Date(), status: OfferStatus.CLOSED },
      include: offerInclude,
    });

    await this.audit.log({
      action: 'OFFER_DELETED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.OFFER,
      entityId: id,
    });

    return updated;
  }
}
