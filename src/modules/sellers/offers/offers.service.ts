import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CurrencyCode,
  EntityOwnerType,
  OfferStatus,
  Prisma,
  PurchaseRequestStatus,
  SellerStatus,
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
  BulkOfferIdsDto,
  CreateOfferDto,
  OfferQueryDto,
  UpdateOfferDto,
} from './offers.dto.js';
import {
  hasSellerCreditPricing,
  isSellerCreditPriceTier,
  sanitizeSellerPaymentTerms,
} from '../../payments/common/platform-credit.js';
import {
  assertNonOverlappingPriceTiers,
  resolveOfferValidityWindow,
} from './offer-price-tiers.util.js';

/** Business window for "expiring soon" KPI (hours). */
const EXPIRING_SOON_HOURS = 48;

const PENDING_PR_STATUSES: PurchaseRequestStatus[] = [
  PurchaseRequestStatus.SOURCING,
  PurchaseRequestStatus.NEGOTIATION,
  PurchaseRequestStatus.OFFER_RECEIVED,
  PurchaseRequestStatus.SUBMITTED,
  PurchaseRequestStatus.UNDER_REVIEW,
];

const offerInclude = {
  product: { select: { id: true, code: true, name: true, gradeId: true } },
  grade: {
    select: { id: true, code: true, name: true, displayName: true },
  },
  priceTiers: { orderBy: { minQty: 'asc' as const } },
  warehouse: {
    select: {
      id: true,
      code: true,
      name: true,
      city: true,
      state: true,
    },
  },
  inventory: {
    select: {
      id: true,
      availableQty: true,
      reservedQty: true,
      warehouseId: true,
    },
  },
  _count: {
    select: { purchaseRequestItems: true },
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

  private async nextOfferNumber(): Promise<string> {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const seq = Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, '0');
      const referenceNumber = `OFF-${ym}-${seq}`;
      const existing = await this.prisma.offer.findUnique({
        where: { referenceNumber },
        select: { id: true },
      });
      if (!existing) return referenceNumber;
    }
    throw new ConflictException('Unable to allocate a unique offer number');
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

  private async assertInventoryOwnership(
    ctx: SellerContext,
    inventoryId: string,
    productId: string,
  ) {
    const inv = await this.prisma.inventory.findFirst({
      where: {
        id: inventoryId,
        organizationId: ctx.organizationId,
        deletedAt: null,
        productId,
      },
    });
    if (!inv) {
      throw new BadRequestException(
        'Inventory not found for this product/seller',
      );
    }
    return inv;
  }

  private async assertWarehouseOwnership(
    ctx: SellerContext,
    warehouseId: string,
  ) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id: warehouseId,
        deletedAt: null,
        OR: [
          { organizationId: ctx.organizationId },
          { organizationId: null },
        ],
      },
    });
    if (!warehouse) {
      throw new BadRequestException('Warehouse not found or not authorized');
    }
    return warehouse;
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
    try {
      assertNonOverlappingPriceTiers(commercial);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'INVALID_BULK_PRICE_RANGE: quantity ranges must not overlap',
      );
    }
    return commercial;
  }

  private assertQuantityRules(quantity: number, moq?: number | null) {
    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be greater than 0');
    }
    if (moq != null && moq > 0 && moq > quantity) {
      throw new BadRequestException(
        'Minimum order quantity cannot exceed available quantity',
      );
    }
  }

  async create(userId: string, dto: CreateOfferDto) {
    const ctx = await this.ctx(userId);
    const product = await this.resolveProduct(ctx, dto.productId, dto.gradeId);

    this.assertQuantityRules(dto.quantity, dto.moq);
    if (dto.basePrice <= 0) {
      throw new BadRequestException('Selling price must be greater than 0');
    }

    let inventoryId = dto.inventoryId;
    let warehouseId = dto.warehouseId;

    if (inventoryId) {
      const inv = await this.assertInventoryOwnership(
        ctx,
        inventoryId,
        product.id,
      );
      if (Number(inv.availableQty) < dto.quantity) {
        throw new BadRequestException(
          'Offer quantity exceeds available inventory',
        );
      }
      warehouseId = warehouseId ?? inv.warehouseId;
    }

    if (warehouseId) {
      await this.assertWarehouseOwnership(ctx, warehouseId);
    }

    const priceTiers = this.commercialPriceTiers(dto.priceTiers);
    if (hasSellerCreditPricing(dto.paymentTerms)) {
      throw new BadRequestException(
        'Seller cannot submit credit pricing. CREDIT is owned by PetroTrade Credit Management.',
      );
    }

    const validity = resolveOfferValidityWindow({
      validityHours: dto.validityHours,
      validFrom: dto.validFrom,
      validUntil: dto.validUntil,
    });
    if (
      validity.validUntil &&
      validity.validFrom &&
      validity.validUntil <= validity.validFrom
    ) {
      throw new BadRequestException(
        'Offer validity end must be after validity start',
      );
    }

    const referenceNumber = await this.nextOfferNumber();

    const offer = await this.prisma.offer.create({
      data: {
        referenceNumber,
        organizationId: ctx.organizationId,
        sellerProfileId: ctx.sellerProfileId,
        productId: product.id,
        gradeId: product.gradeId,
        inventoryId,
        warehouseId,
        quantity: dto.quantity,
        moq: dto.moq,
        unit: dto.unit ?? product.unit ?? 'MT',
        basePrice: dto.basePrice,
        currency: dto.currency ?? CurrencyCode.INR,
        pricingBasis: dto.pricingBasis,
        paymentTerms: sanitizeSellerPaymentTerms(dto.paymentTerms) as
          | Prisma.InputJsonValue
          | undefined,
        deliveryTerms: dto.deliveryTerms,
        validFrom: validity.validFrom,
        validUntil: validity.validUntil,
        status: OfferStatus.DRAFT,
        visibility: dto.visibility ?? 'MARKETPLACE',
        version: 1,
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
        basePrice: offer.basePrice.toString(),
        quantity: offer.quantity.toString(),
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
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { referenceNumber: { contains: q, mode: 'insensitive' } },
        { product: { name: { contains: q, mode: 'insensitive' } } },
        { product: { code: { contains: q, mode: 'insensitive' } } },
        { grade: { name: { contains: q, mode: 'insensitive' } } },
        { grade: { code: { contains: q, mode: 'insensitive' } } },
        { grade: { displayName: { contains: q, mode: 'insensitive' } } },
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

  async summary(userId: string) {
    const ctx = await this.ctx(userId);
    const orgId = ctx.organizationId;
    const now = new Date();
    const expiringUntil = new Date(
      now.getTime() + EXPIRING_SOON_HOURS * 60 * 60 * 1000,
    );
    const base = { organizationId: orgId, deletedAt: null };

    const [
      active,
      draft,
      paused,
      expired,
      pendingReview,
      closed,
      rejected,
      expiringSoon,
      soldOut,
      pendingPurchaseRequests,
    ] = await Promise.all([
      this.prisma.offer.count({
        where: { ...base, status: OfferStatus.ACTIVE },
      }),
      this.prisma.offer.count({
        where: { ...base, status: OfferStatus.DRAFT },
      }),
      this.prisma.offer.count({
        where: { ...base, status: OfferStatus.PAUSED },
      }),
      this.prisma.offer.count({
        where: { ...base, status: OfferStatus.EXPIRED },
      }),
      this.prisma.offer.count({
        where: { ...base, status: OfferStatus.PENDING_REVIEW },
      }),
      this.prisma.offer.count({
        where: { ...base, status: OfferStatus.CLOSED },
      }),
      this.prisma.offer.count({
        where: { ...base, status: OfferStatus.REJECTED },
      }),
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
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          sellerOrgId: orgId,
          status: { in: PENDING_PR_STATUSES },
        },
      }),
    ]);

    return {
      active,
      draft,
      paused,
      expired,
      pendingReview,
      closed,
      rejected,
      expiringSoon,
      soldOut,
      pendingPurchaseRequests,
      expiringSoonWindowHours: EXPIRING_SOON_HOURS,
    };
  }

  async findOne(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    return this.assertOwned(ctx, id);
  }

  async history(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    await this.assertOwned(ctx, id);
    return this.prisma.auditLog.findMany({
      where: {
        entityType: EntityOwnerType.OFFER,
        entityId: id,
        organizationId: ctx.organizationId,
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

  async purchaseRequestsForOffer(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    await this.assertOwned(ctx, id);
    const items = await this.prisma.purchaseRequestItem.findMany({
      where: {
        offerId: id,
        purchaseRequest: {
          deletedAt: null,
          sellerOrgId: ctx.organizationId,
        },
      },
      include: {
        purchaseRequest: {
          select: {
            id: true,
            referenceNumber: true,
            status: true,
            paymentMethod: true,
            targetPrice: true,
            currency: true,
            commercialSnapshot: true,
            createdAt: true,
            updatedAt: true,
            responseDeadline: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return items.map((item) => ({
      id: item.purchaseRequest.id,
      referenceNumber: item.purchaseRequest.referenceNumber,
      status: item.purchaseRequest.status,
      paymentMethod: item.purchaseRequest.paymentMethod,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPriceSnapshot?.toString() ?? null,
      currency: item.purchaseRequest.currency,
      commercialSnapshot: item.purchaseRequest.commercialSnapshot,
      createdAt: item.purchaseRequest.createdAt,
      updatedAt: item.purchaseRequest.updatedAt,
      responseDeadline: item.purchaseRequest.responseDeadline,
    }));
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

    if (dto.version != null && dto.version !== existing.version) {
      throw new ConflictException(
        'This offer was updated from another session. Refresh and review the latest version.',
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

    const nextQuantity =
      dto.quantity !== undefined ? dto.quantity : Number(existing.quantity);
    const nextMoq =
      dto.moq !== undefined
        ? dto.moq
        : existing.moq != null
          ? Number(existing.moq)
          : undefined;
    this.assertQuantityRules(nextQuantity, nextMoq);

    if (dto.basePrice != null && dto.basePrice <= 0) {
      throw new BadRequestException('Selling price must be greater than 0');
    }

    if (dto.inventoryId) {
      await this.assertInventoryOwnership(ctx, dto.inventoryId, productId);
    }
    if (dto.warehouseId) {
      await this.assertWarehouseOwnership(ctx, dto.warehouseId);
    }

    if (dto.priceTiers) {
      this.commercialPriceTiers(dto.priceTiers);
    }
    if (hasSellerCreditPricing(dto.paymentTerms)) {
      throw new BadRequestException(
        'Seller cannot submit credit pricing. CREDIT is owned by PetroTrade Credit Management.',
      );
    }

    const validityTouched =
      dto.validityHours != null ||
      dto.validFrom !== undefined ||
      dto.validUntil !== undefined;
    const validity = validityTouched
      ? resolveOfferValidityWindow({
          validityHours: dto.validityHours,
          validFrom: dto.validFrom,
          validUntil: dto.validUntil,
        })
      : null;

    const priceChanged =
      dto.basePrice != null &&
      Number(dto.basePrice) !== Number(existing.basePrice);
    const quantityChanged =
      dto.quantity != null &&
      Number(dto.quantity) !== Number(existing.quantity);

    const offer = await this.prisma.$transaction(async (tx) => {
      if (dto.version != null) {
        const locked = await tx.offer.findFirst({
          where: { id, version: dto.version, deletedAt: null },
        });
        if (!locked) {
          throw new ConflictException(
            'This offer was updated from another session. Refresh and review the latest version.',
          );
        }
      }

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
                  | Prisma.InputJsonValue
                  | undefined),
          deliveryTerms: dto.deliveryTerms,
          validFrom: validity ? validity.validFrom : undefined,
          validUntil: validity ? validity.validUntil : undefined,
          visibility: dto.visibility,
          metadata:
            dto.metadata === undefined
              ? undefined
              : (dto.metadata as Prisma.InputJsonValue),
          version: { increment: 1 },
        },
        include: offerInclude,
      });
    });

    await this.audit.log({
      action: priceChanged
        ? 'OFFER_PRICE_CHANGED'
        : quantityChanged
          ? 'OFFER_QUANTITY_CHANGED'
          : 'OFFER_UPDATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.OFFER,
      entityId: id,
      previousData: {
        status: existing.status,
        basePrice: existing.basePrice.toString(),
        quantity: existing.quantity.toString(),
        version: existing.version,
      },
      newData: {
        status: offer.status,
        basePrice: offer.basePrice.toString(),
        quantity: offer.quantity.toString(),
        version: offer.version,
      },
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

    if (offer.status === OfferStatus.PAUSED) {
      return this.resume(userId, id);
    }

    if (
      offer.status !== OfferStatus.DRAFT &&
      offer.status !== OfferStatus.PENDING_REVIEW
    ) {
      throw new BadRequestException(
        `Cannot activate offer in status ${offer.status}`,
      );
    }

    if (offer.validUntil && offer.validUntil < new Date()) {
      throw new BadRequestException('Cannot activate an expired offer');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      let current = offer;
      if (current.status === OfferStatus.DRAFT) {
        current = await tx.offer.update({
          where: { id },
          data: {
            status: OfferStatus.PENDING_REVIEW,
            // Ensure marketplace window is anchored to server time on publish.
            validFrom: current.validFrom ?? new Date(),
            version: { increment: 1 },
          },
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
        data: {
          status: OfferStatus.ACTIVE,
          validFrom: current.validFrom ?? new Date(),
          version: { increment: 1 },
        },
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

  async resume(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    const offer = await this.assertOwned(ctx, id);
    if (ctx.status !== SellerStatus.APPROVED) {
      throw new BadRequestException(
        'Only APPROVED sellers can resume offers',
      );
    }
    if (offer.status !== OfferStatus.PAUSED) {
      throw new BadRequestException(
        `Cannot resume offer in status ${offer.status}`,
      );
    }
    if (offer.validUntil && offer.validUntil < new Date()) {
      throw new BadRequestException('Cannot resume an expired offer');
    }

    const updated = await this.prisma.offer.update({
      where: { id },
      data: { status: OfferStatus.ACTIVE, version: { increment: 1 } },
      include: offerInclude,
    });

    await this.audit.log({
      action: 'OFFER_ACTIVATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.OFFER,
      entityId: id,
      previousData: { status: offer.status },
      newData: { status: updated.status },
      metadata: { via: 'resume' },
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
      data: { status: OfferStatus.PAUSED, version: { increment: 1 } },
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
      data: { status: OfferStatus.EXPIRED, version: { increment: 1 } },
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

  async cancel(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    const offer = await this.assertOwned(ctx, id);
    if (
      offer.status === OfferStatus.CLOSED ||
      offer.status === OfferStatus.EXPIRED
    ) {
      throw new BadRequestException(
        `Cannot cancel offer in status ${offer.status}`,
      );
    }
    const updated = await this.prisma.offer.update({
      where: { id },
      data: {
        status: OfferStatus.CLOSED,
        deletedAt: new Date(),
        version: { increment: 1 },
      },
      include: offerInclude,
    });

    await this.audit.log({
      action: 'OFFER_CANCELLED',
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
    return this.cancel(userId, id);
  }

  async bulkActivate(userId: string, dto: BulkOfferIdsDto) {
    const results: Array<{
      offerId: string;
      success: boolean;
      error?: string;
    }> = [];
    for (const offerId of dto.offerIds) {
      try {
        await this.activate(userId, offerId);
        results.push({ offerId, success: true });
      } catch (error) {
        results.push({
          offerId,
          success: false,
          error: error instanceof Error ? error.message : 'Failed to activate',
        });
      }
    }
    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  async bulkPause(userId: string, dto: BulkOfferIdsDto) {
    const results: Array<{
      offerId: string;
      success: boolean;
      error?: string;
    }> = [];
    for (const offerId of dto.offerIds) {
      try {
        await this.pause(userId, offerId);
        results.push({ offerId, success: true });
      } catch (error) {
        results.push({
          offerId,
          success: false,
          error: error instanceof Error ? error.message : 'Failed to pause',
        });
      }
    }
    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }
}
