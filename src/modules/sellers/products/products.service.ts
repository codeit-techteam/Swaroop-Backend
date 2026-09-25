import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CurrencyCode,
  EntityOwnerType,
  GradeStatus,
  InventoryStatus,
  OfferStatus,
  Prisma,
  ProductStatus,
  SellerStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { handlePrismaUnique } from '../../master-data/common/prisma-helpers.js';
import { SellerAuditService } from '../common/seller-audit.service.js';
import {
  nextReference,
  SellerContext,
  SellerContextService,
} from '../common/seller-context.service.js';
import type {
  CreateMarketplaceListingDto,
  CreateProductDto,
  CreateProductMediaDto,
  ProductQueryDto,
  UpdateProductDto,
  UpdateProductStatusDto,
} from './products.dto.js';

const productInclude = {
  grade: {
    select: {
      id: true,
      code: true,
      name: true,
      displayName: true,
      status: true,
      category: { select: { id: true, code: true, name: true } },
    },
  },
  media: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' as const } },
  inventory: {
    where: { deletedAt: null },
    orderBy: { updatedAt: 'desc' as const },
    take: 5,
    select: {
      id: true,
      availableQty: true,
      reservedQty: true,
      allocatedQty: true,
      unit: true,
      status: true,
      warehouseId: true,
      warehouse: { select: { id: true, name: true, city: true, code: true } },
    },
  },
  offers: {
    where: { deletedAt: null },
    orderBy: { updatedAt: 'desc' as const },
    take: 5,
    select: {
      id: true,
      basePrice: true,
      moq: true,
      quantity: true,
      unit: true,
      status: true,
      currency: true,
      deliveryTerms: true,
      warehouseId: true,
      inventoryId: true,
      priceTiers: {
        orderBy: { minQty: 'asc' as const },
        select: {
          id: true,
          minQty: true,
          maxQty: true,
          price: true,
          currency: true,
        },
      },
    },
  },
} satisfies Prisma.ProductInclude;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerContext: SellerContextService,
    private readonly audit: SellerAuditService,
  ) {}

  private async ctx(userId: string) {
    return this.sellerContext.requireSeller(userId);
  }

  private async assertOwnedProduct(ctx: SellerContext, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId: ctx.organizationId, deletedAt: null },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private async assertActiveGrade(gradeId: string) {
    const grade = await this.prisma.grade.findFirst({
      where: {
        id: gradeId,
        deletedAt: null,
        status: GradeStatus.ACTIVE,
      },
    });
    if (!grade) {
      throw new BadRequestException(
        'Grade not found or inactive. Select an ACTIVE grade from Grade Master.',
      );
    }
    return grade;
  }

  async create(userId: string, dto: CreateProductDto) {
    const ctx = await this.ctx(userId);
    await this.assertActiveGrade(dto.gradeId);

    try {
      const product = await this.prisma.product.create({
        data: {
          organizationId: ctx.organizationId,
          sellerProfileId: ctx.sellerProfileId,
          gradeId: dto.gradeId,
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          brand: dto.brand,
          manufacturer: dto.manufacturer,
          description: dto.description,
          technicalSpecs: dto.technicalSpecs as Prisma.InputJsonValue,
          mfi: dto.mfi,
          density: dto.density,
          packaging: dto.packaging,
          unit: dto.unit ?? 'MT',
          countryOfOrigin: dto.countryOfOrigin,
          supplyOrigin: dto.supplyOrigin,
          status: ProductStatus.DRAFT,
          metadata: dto.metadata as Prisma.InputJsonValue,
          media: dto.media?.length
            ? {
                create: dto.media.map((m) => ({
                  type: m.type,
                  storageKey: m.storageKey,
                  fileName: m.fileName,
                  mimeType: m.mimeType,
                  fileSizeBytes:
                    m.fileSizeBytes != null
                      ? BigInt(m.fileSizeBytes)
                      : undefined,
                  sortOrder: m.sortOrder ?? 0,
                  metadata: m.metadata as Prisma.InputJsonValue,
                })),
              }
            : undefined,
        },
        include: productInclude,
      });

      await this.audit.log({
        action: 'PRODUCT_CREATED',
        actorUserId: userId,
        organizationId: ctx.organizationId,
        entityType: EntityOwnerType.PRODUCT,
        entityId: product.id,
        newData: { code: product.code, status: product.status },
      });

      return this.serialize(product);
    } catch (error) {
      handlePrismaUnique(error, 'Product code already exists for this seller');
    }
  }

  /**
   * Production listing: Product + Inventory + Offer (+ optional marketplace publish).
   * Customers only see ACTIVE product + ACTIVE offer; documents attach after create.
   */
  async createListing(userId: string, dto: CreateMarketplaceListingDto) {
    const ctx = await this.ctx(userId);
    await this.assertActiveGrade(dto.gradeId);

    const warehouse = await this.resolveListingWarehouse(ctx, dto);
    const publish = dto.publishToMarketplace !== false;
    if (publish && ctx.status !== SellerStatus.APPROVED) {
      throw new BadRequestException(
        'Only APPROVED sellers can publish listings to the marketplace',
      );
    }

    const technicalSpecs: Record<string, unknown> = {
      ...(dto.technicalSpecs ?? {}),
      ...(dto.application ? { application: dto.application } : {}),
      ...(dto.polymerType ? { polymerType: dto.polymerType } : {}),
      ...(dto.warehouseName || warehouse.name
        ? { warehouseLabel: dto.warehouseName ?? warehouse.name }
        : {}),
      ...(Array.isArray((dto.technicalSpecs as { applications?: unknown })?.applications)
        ? {}
        : dto.application
          ? { applications: [dto.application] }
          : {}),
    };

    const productStatus = publish
      ? ProductStatus.ACTIVE
      : ProductStatus.DRAFT;
    const offerStatus = publish ? OfferStatus.ACTIVE : OfferStatus.DRAFT;
    const stock = Number(dto.availableStock ?? 0);
    const unit = dto.unit ?? 'MT';

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            organizationId: ctx.organizationId,
            sellerProfileId: ctx.sellerProfileId,
            gradeId: dto.gradeId,
            code: dto.code.trim().toUpperCase(),
            name: dto.name.trim(),
            brand: dto.brand ?? dto.manufacturer,
            manufacturer: dto.manufacturer,
            description: dto.description ?? dto.notes,
            technicalSpecs: technicalSpecs as Prisma.InputJsonValue,
            mfi: dto.mfi,
            density: dto.density,
            packaging: dto.packaging,
            unit,
            countryOfOrigin: dto.countryOfOrigin,
            supplyOrigin: dto.supplyOrigin ?? dto.countryOfOrigin,
            status: productStatus,
            metadata: {
              ...(dto.metadata ?? {}),
              notes: dto.notes ?? null,
              reservedStock: dto.reservedStock ?? 0,
            } as Prisma.InputJsonValue,
          },
        });

        const inventory = await tx.inventory.create({
          data: {
            organizationId: ctx.organizationId,
            productId: product.id,
            warehouseId: warehouse.id,
            availableQty: stock,
            reservedQty: dto.reservedStock ?? 0,
            unit,
            status:
              stock > 0
                ? InventoryStatus.AVAILABLE
                : InventoryStatus.OUT_OF_STOCK,
          },
        });

        const offer = await tx.offer.create({
          data: {
            referenceNumber: nextReference('OFFER'),
            organizationId: ctx.organizationId,
            sellerProfileId: ctx.sellerProfileId,
            productId: product.id,
            gradeId: product.gradeId,
            inventoryId: inventory.id,
            warehouseId: warehouse.id,
            quantity: stock,
            moq: dto.moq,
            unit,
            basePrice: dto.sellingPrice,
            currency: CurrencyCode.INR,
            pricingBasis: 'EXW',
            deliveryTerms: estimateDeliveryTerms(warehouse.city ?? warehouse.name),
            status: offerStatus,
            visibility: 'MARKETPLACE',
            createdById: userId,
            priceTiers: dto.priceTiers?.length
              ? {
                  create: dto.priceTiers.map((t) => ({
                    minQty: t.minQty,
                    maxQty: t.maxQty ?? undefined,
                    price: t.price,
                    currency: CurrencyCode.INR,
                  })),
                }
              : undefined,
          },
        });

        return { productId: product.id, offerId: offer.id, inventoryId: inventory.id };
      });

      await this.audit.log({
        action: 'PRODUCT_CREATED',
        actorUserId: userId,
        organizationId: ctx.organizationId,
        entityType: EntityOwnerType.PRODUCT,
        entityId: result.productId,
        newData: {
          listing: true,
          offerId: result.offerId,
          status: productStatus,
          published: publish,
        },
      });

      const product = await this.assertOwnedProduct(ctx, result.productId);
      return {
        ...this.serialize(product),
        offerId: result.offerId,
        inventoryId: result.inventoryId,
        warehouseId: warehouse.id,
        published: publish,
      };
    } catch (error) {
      handlePrismaUnique(error, 'Product code already exists for this seller');
    }
  }

  private async resolveListingWarehouse(
    ctx: SellerContext,
    dto: CreateMarketplaceListingDto,
  ) {
    if (dto.warehouseId) {
      const warehouse = await this.prisma.warehouse.findFirst({
        where: {
          id: dto.warehouseId,
          deletedAt: null,
          OR: [
            { organizationId: ctx.organizationId },
            { organizationId: null, isPlatformHub: true },
          ],
        },
      });
      if (!warehouse) {
        throw new BadRequestException('Warehouse not found or not accessible');
      }
      return warehouse;
    }

    const name = dto.warehouseName?.trim();
    if (name) {
      const existing = await this.prisma.warehouse.findFirst({
        where: {
          deletedAt: null,
          name: { equals: name, mode: 'insensitive' },
          OR: [
            { organizationId: ctx.organizationId },
            { organizationId: null, isPlatformHub: true },
          ],
        },
      });
      if (existing) return existing;

      const codeBase = name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 24);
      const code = `WH-${codeBase || 'SELLER'}-${Date.now().toString(36).toUpperCase()}`;
      return this.prisma.warehouse.create({
        data: {
          organizationId: ctx.organizationId,
          code,
          name,
          country: 'IN',
          isPlatformHub: false,
          isActive: true,
        },
      });
    }

    const hub = await this.prisma.warehouse.findFirst({
      where: {
        deletedAt: null,
        isPlatformHub: true,
        OR: [{ organizationId: null }, { organizationId: ctx.organizationId }],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!hub) {
      throw new BadRequestException(
        'No warehouse available. Provide warehouseName or seed a platform hub.',
      );
    }
    return hub;
  }

  async findAll(userId: string, query: ProductQueryDto) {
    const ctx = await this.ctx(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.ProductWhereInput = {
      organizationId: ctx.organizationId,
      deletedAt: null,
    };
    if (query.status) where.status = query.status;
    if (query.gradeId) where.gradeId = query.gradeId;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { brand: { contains: q, mode: 'insensitive' } },
      ];
    }

    const orderByField = query.sortBy === 'name' ? 'name' : 'createdAt';
    const [total, items] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: {
          [orderByField]: query.sortOrder === 'asc' ? 'asc' : 'desc',
        },
        skip,
        take,
      }),
    ]);

    return {
      items: items.map((p) => this.serialize(p)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    return this.serialize(await this.assertOwnedProduct(ctx, id));
  }

  async update(userId: string, id: string, dto: UpdateProductDto) {
    const ctx = await this.ctx(userId);
    const existing = await this.assertOwnedProduct(ctx, id);
    if (dto.gradeId) await this.assertActiveGrade(dto.gradeId);

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        if (dto.media) {
          await tx.productMedia.updateMany({
            where: { productId: id, deletedAt: null },
            data: { deletedAt: new Date() },
          });
          if (dto.media.length) {
            await tx.productMedia.createMany({
              data: dto.media.map((m) => ({
                productId: id,
                type: m.type,
                storageKey: m.storageKey,
                fileName: m.fileName,
                mimeType: m.mimeType,
                fileSizeBytes:
                  m.fileSizeBytes != null ? BigInt(m.fileSizeBytes) : null,
                sortOrder: m.sortOrder ?? 0,
                metadata: m.metadata as Prisma.InputJsonValue,
              })),
            });
          }
        }

        return tx.product.update({
          where: { id },
          data: {
            gradeId: dto.gradeId,
            code: dto.code?.trim().toUpperCase(),
            name: dto.name?.trim(),
            brand: dto.brand,
            manufacturer: dto.manufacturer,
            description: dto.description,
            technicalSpecs:
              dto.technicalSpecs === undefined
                ? undefined
                : (dto.technicalSpecs as Prisma.InputJsonValue),
            mfi: dto.mfi,
            density: dto.density,
            packaging: dto.packaging,
            unit: dto.unit,
            countryOfOrigin: dto.countryOfOrigin,
            supplyOrigin: dto.supplyOrigin,
            metadata:
              dto.metadata === undefined
                ? undefined
                : (dto.metadata as Prisma.InputJsonValue),
          },
          include: productInclude,
        });
      });

      await this.audit.log({
        action: 'PRODUCT_UPDATED',
        actorUserId: userId,
        organizationId: ctx.organizationId,
        entityType: EntityOwnerType.PRODUCT,
        entityId: id,
        previousData: { code: existing.code, status: existing.status },
        newData: { code: product.code, status: product.status },
      });

      return this.serialize(product);
    } catch (error) {
      handlePrismaUnique(error, 'Product code already exists for this seller');
    }
  }

  async publish(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    const product = await this.assertOwnedProduct(ctx, id);
    if (ctx.status !== SellerStatus.APPROVED) {
      throw new BadRequestException(
        'Only APPROVED sellers can publish products',
      );
    }
    if (
      product.status !== ProductStatus.DRAFT &&
      product.status !== ProductStatus.PAUSED &&
      product.status !== ProductStatus.REJECTED
    ) {
      throw new BadRequestException(
        `Cannot publish product in status ${product.status}`,
      );
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.PENDING_REVIEW },
      include: productInclude,
    });

    await this.audit.log({
      action: 'PRODUCT_PUBLISHED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
      previousData: { status: product.status },
      newData: { status: updated.status },
    });

    return this.serialize(updated);
  }

  async activate(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    const product = await this.assertOwnedProduct(ctx, id);
    if (ctx.status !== SellerStatus.APPROVED) {
      throw new BadRequestException(
        'Only APPROVED sellers can activate products',
      );
    }
    if (product.status !== ProductStatus.PENDING_REVIEW) {
      throw new BadRequestException(
        'Only PENDING_REVIEW products can be activated',
      );
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.ACTIVE },
      include: productInclude,
    });

    await this.audit.log({
      action: 'PRODUCT_ACTIVATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
      previousData: { status: product.status },
      newData: { status: updated.status },
    });

    return this.serialize(updated);
  }

  async unpublish(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    const product = await this.assertOwnedProduct(ctx, id);
    if (
      product.status !== ProductStatus.ACTIVE &&
      product.status !== ProductStatus.PENDING_REVIEW
    ) {
      throw new BadRequestException(
        `Cannot unpublish product in status ${product.status}`,
      );
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.PAUSED },
      include: productInclude,
    });

    await this.audit.log({
      action: 'PRODUCT_UNPUBLISHED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
      previousData: { status: product.status },
      newData: { status: updated.status },
    });

    return this.serialize(updated);
  }

  async updateStatus(userId: string, id: string, dto: UpdateProductStatusDto) {
    const ctx = await this.ctx(userId);
    const product = await this.assertOwnedProduct(ctx, id);
    const updated = await this.prisma.product.update({
      where: { id },
      data: { status: dto.status },
      include: productInclude,
    });

    await this.audit.log({
      action: 'PRODUCT_STATUS_UPDATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
      previousData: { status: product.status },
      newData: { status: updated.status },
    });

    return this.serialize(updated);
  }


  /**
   * Update listing commercial fields: product specs, stock, price, MOQ, tiers.
   * Keeps inventory + marketplace offer quantity/price in sync.
   */
  async updateListing(userId: string, id: string, dto: CreateMarketplaceListingDto) {
    const ctx = await this.ctx(userId);
    const existing = await this.assertOwnedProduct(ctx, id);
    if (dto.gradeId && dto.gradeId !== existing.gradeId) {
      await this.assertActiveGrade(dto.gradeId);
    }

    const warehouse = await this.resolveListingWarehouse(ctx, dto);
    const stock = Number(dto.availableStock ?? 0);
    const unit = dto.unit ?? existing.unit ?? 'MT';
    const technicalSpecs: Record<string, unknown> = {
      ...(typeof existing.technicalSpecs === 'object' && existing.technicalSpecs
        ? (existing.technicalSpecs as Record<string, unknown>)
        : {}),
      ...(dto.technicalSpecs ?? {}),
      ...(dto.application ? { application: dto.application } : {}),
      ...(dto.polymerType ? { polymerType: dto.polymerType } : {}),
      warehouseLabel: dto.warehouseName ?? warehouse.name,
      ...(dto.application ? { applications: [dto.application] } : {}),
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          gradeId: dto.gradeId ?? undefined,
          code: dto.code?.trim().toUpperCase(),
          name: dto.name?.trim(),
          brand: dto.brand ?? dto.manufacturer,
          manufacturer: dto.manufacturer,
          description: dto.description ?? dto.notes,
          technicalSpecs: technicalSpecs as Prisma.InputJsonValue,
          mfi: dto.mfi,
          density: dto.density,
          packaging: dto.packaging,
          unit,
          countryOfOrigin: dto.countryOfOrigin,
          supplyOrigin: dto.supplyOrigin ?? dto.countryOfOrigin,
          metadata: {
            ...((existing.metadata as Record<string, unknown>) ?? {}),
            notes: dto.notes ?? null,
            reservedStock: dto.reservedStock ?? 0,
          } as Prisma.InputJsonValue,
        },
      });

      const inventory =
        existing.inventory?.[0] ??
        (await tx.inventory.findFirst({
          where: { productId: id, organizationId: ctx.organizationId, deletedAt: null },
        }));

      let inventoryId = inventory?.id;
      if (inventoryId) {
        await tx.inventory.update({
          where: { id: inventoryId },
          data: {
            warehouseId: warehouse.id,
            availableQty: stock,
            reservedQty: dto.reservedStock ?? 0,
            unit,
            status:
              stock > 0
                ? InventoryStatus.AVAILABLE
                : InventoryStatus.OUT_OF_STOCK,
          },
        });
      } else {
        const created = await tx.inventory.create({
          data: {
            organizationId: ctx.organizationId,
            productId: id,
            warehouseId: warehouse.id,
            availableQty: stock,
            reservedQty: dto.reservedStock ?? 0,
            unit,
            status:
              stock > 0
                ? InventoryStatus.AVAILABLE
                : InventoryStatus.OUT_OF_STOCK,
          },
        });
        inventoryId = created.id;
      }

      const offer =
        existing.offers?.[0] ??
        (await tx.offer.findFirst({
          where: { productId: id, organizationId: ctx.organizationId, deletedAt: null },
          orderBy: { updatedAt: 'desc' },
        }));

      if (offer) {
        await tx.offerPriceTier.deleteMany({ where: { offerId: offer.id } });
        await tx.offer.update({
          where: { id: offer.id },
          data: {
            inventoryId,
            warehouseId: warehouse.id,
            quantity: stock,
            moq: dto.moq,
            unit,
            basePrice: dto.sellingPrice,
            deliveryTerms: estimateDeliveryTerms(warehouse.city ?? warehouse.name),
            priceTiers: dto.priceTiers?.length
              ? {
                  create: dto.priceTiers.map((t) => ({
                    minQty: t.minQty,
                    maxQty: t.maxQty ?? undefined,
                    price: t.price,
                    currency: CurrencyCode.INR,
                  })),
                }
              : undefined,
          },
        });
      } else {
        await tx.offer.create({
          data: {
            referenceNumber: nextReference('OFFER'),
            organizationId: ctx.organizationId,
            sellerProfileId: ctx.sellerProfileId,
            productId: id,
            gradeId: existing.gradeId,
            inventoryId,
            warehouseId: warehouse.id,
            quantity: stock,
            moq: dto.moq,
            unit,
            basePrice: dto.sellingPrice,
            currency: CurrencyCode.INR,
            pricingBasis: 'EXW',
            deliveryTerms: estimateDeliveryTerms(warehouse.city ?? warehouse.name),
            status: OfferStatus.ACTIVE,
            visibility: 'MARKETPLACE',
            createdById: userId,
            priceTiers: dto.priceTiers?.length
              ? {
                  create: dto.priceTiers.map((t) => ({
                    minQty: t.minQty,
                    maxQty: t.maxQty ?? undefined,
                    price: t.price,
                    currency: CurrencyCode.INR,
                  })),
                }
              : undefined,
          },
        });
      }
    });

    await this.audit.log({
      action: 'PRODUCT_UPDATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
      newData: { listingUpdate: true, availableStock: stock, sellingPrice: dto.sellingPrice },
    });

    return this.serialize(await this.assertOwnedProduct(ctx, id));
  }

  async softDelete(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    await this.assertOwnedProduct(ctx, id);
    const updated = await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), status: ProductStatus.ARCHIVED },
      include: productInclude,
    });

    await this.audit.log({
      action: 'PRODUCT_DELETED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
    });

    return this.serialize(updated);
  }

  async addMedia(
    userId: string,
    productId: string,
    dto: CreateProductMediaDto,
  ) {
    const ctx = await this.ctx(userId);
    await this.assertOwnedProduct(ctx, productId);
    const media = await this.prisma.productMedia.create({
      data: {
        productId,
        type: dto.type,
        storageKey: dto.storageKey,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        fileSizeBytes:
          dto.fileSizeBytes != null ? BigInt(dto.fileSizeBytes) : undefined,
        sortOrder: dto.sortOrder ?? 0,
        metadata: dto.metadata as Prisma.InputJsonValue,
      },
    });
    return this.serializeMedia(media);
  }

  async removeMedia(userId: string, productId: string, mediaId: string) {
    const ctx = await this.ctx(userId);
    await this.assertOwnedProduct(ctx, productId);
    const media = await this.prisma.productMedia.findFirst({
      where: { id: mediaId, productId, deletedAt: null },
    });
    if (!media) throw new NotFoundException('Product media not found');
    await this.prisma.productMedia.update({
      where: { id: mediaId },
      data: { deletedAt: new Date() },
    });
    return { id: mediaId, deleted: true };
  }

  private serialize(
    product: Prisma.ProductGetPayload<{ include: typeof productInclude }>,
  ) {
    return {
      ...product,
      media: product.media.map((m) => this.serializeMedia(m)),
    };
  }

  private serializeMedia(media: {
    id: string;
    productId: string;
    type: string;
    storageKey: string;
    fileName: string | null;
    mimeType: string | null;
    fileSizeBytes: bigint | null;
    sortOrder: number;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
  }) {
    return {
      ...media,
      fileSizeBytes:
        media.fileSizeBytes != null ? Number(media.fileSizeBytes) : null,
    };
  }
}

/** Blind-marketplace safe ETA label from warehouse geography. */
export function estimateDeliveryTerms(locationHint?: string | null): string {
  const hint = (locationHint ?? '').toLowerCase();
  if (
    hint.includes('mumbai') ||
    hint.includes('pune') ||
    hint.includes('nashik') ||
    hint.includes('gujarat') ||
    hint.includes('ahmedabad')
  ) {
    return '2–3 Business Days';
  }
  if (
    hint.includes('chennai') ||
    hint.includes('kolkata') ||
    hint.includes('howrah') ||
    hint.includes('delhi') ||
    hint.includes('hyderabad') ||
    hint.includes('bangalore') ||
    hint.includes('bengaluru')
  ) {
    return '3–5 Business Days';
  }
  return '4–6 Business Days';
}
