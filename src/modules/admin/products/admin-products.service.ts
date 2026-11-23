import {
  BadRequestException,
  ConflictException,
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
import { listingDisplayName } from '../../customers/common/blind-marketplace.mapper.js';
import {
  DEFAULT_DISPATCH_WINDOW,
  estimateDeliveryTerms,
} from '../../customers/common/delivery-timing.js';
import { assessMaterialPriceReview } from '../../customers/checkout/commerce-pricing.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { nextReference } from '../../sellers/common/seller-context.service.js';
import { AdminAuditService } from '../common/admin-audit.service.js';
import type {
  AdminCreateMarketplaceListingDto,
  AdminCreateProductDto,
  AdminProductsQueryDto,
  AdminUpdateProductDto,
  AdminUpdateProductStatusDto,
} from './admin-products.dto.js';

const productInclude = {
  grade: {
    select: {
      id: true,
      code: true,
      name: true,
      displayName: true,
      gradeNo: true,
      manufacturer: true,
      gradeGroup: true,
    },
  },
  organization: {
    select: { id: true, name: true, legalName: true, code: true },
  },
  sellerProfile: { select: { id: true, status: true } },
  inventory: {
    where: { deletedAt: null },
    select: { availableQty: true, warehouseId: true },
  },
  offers: {
    where: { deletedAt: null, status: OfferStatus.ACTIVE },
    select: { id: true, status: true, basePrice: true, moq: true },
  },
} satisfies Prisma.ProductInclude;

function withCatalogAggregates<
  T extends {
    inventory?: Array<{ availableQty: unknown }>;
    offers?: Array<{ id: string }>;
  },
>(product: T) {
  const inventoryAvailableQty = (product.inventory ?? []).reduce(
    (sum, row) => sum + Number(row.availableQty ?? 0),
    0,
  );
  return {
    ...product,
    inventoryAvailableQty,
    activeOfferCount: product.offers?.length ?? 0,
  };
}

/** Turn filenames / codes into searchable tokens: ABS_EXTRUSION_SR101_TDS.pdf → ["SR101", ...] */
function searchTokensFromQuery(raw: string): string[] {
  const cleaned = raw
    .replace(/\.(pdf|png|jpe?g|webp)$/i, '')
    .replace(/[_\-/]+/g, ' ')
    .replace(/\b(TDS|TECHNICAL|DATA|SHEET|DOCUMENT)\b/gi, ' ')
    .trim();
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  // Prefer distinctive grade-like tokens (letters+digits) first.
  tokens.sort((a, b) => {
    const score = (t: string) =>
      (/[A-Z]/i.test(t) && /\d/.test(t) ? 0 : t.length >= 4 ? 1 : 2);
    return score(a) - score(b) || b.length - a.length;
  });
  return [...new Set(tokens)].slice(0, 6);
}

@Injectable()
export class AdminProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminProductsQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.ProductWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.organizationId) where.organizationId = query.organizationId;
    if (query.gradeId) where.gradeId = query.gradeId;
    if (query.search?.trim()) {
      const q = query.search.trim();
      const tokens = searchTokensFromQuery(q);
      const phrases = [q, ...tokens].filter(Boolean);
      const fieldMatchers = (term: string): Prisma.ProductWhereInput[] => [
        { code: { contains: term, mode: 'insensitive' } },
        { name: { contains: term, mode: 'insensitive' } },
        { brand: { contains: term, mode: 'insensitive' } },
        { manufacturer: { contains: term, mode: 'insensitive' } },
        {
          grade: {
            is: {
              OR: [
                { code: { contains: term, mode: 'insensitive' } },
                { name: { contains: term, mode: 'insensitive' } },
                { displayName: { contains: term, mode: 'insensitive' } },
                { gradeNo: { contains: term, mode: 'insensitive' } },
                { manufacturer: { contains: term, mode: 'insensitive' } },
                { gradeGroup: { contains: term, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
      where.OR = phrases.flatMap((term) => fieldMatchers(term));
    }

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: items.map((item) => withCatalogAggregates(item)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('Product not found');
    return withCatalogAggregates(product);
  }

  async create(dto: AdminCreateProductDto, actorUserId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: dto.organizationId, deletedAt: null },
      include: { sellerProfile: true },
    });
    if (!org) throw new BadRequestException('Organization not found');
    if (!org.sellerProfile) {
      throw new BadRequestException(
        'organizationId must belong to a seller organization',
      );
    }

    const grade = await this.prisma.grade.findFirst({
      where: { id: dto.gradeId, deletedAt: null, status: GradeStatus.ACTIVE },
    });
    if (!grade) {
      throw new BadRequestException('Grade not found or inactive');
    }

    // One ACTIVE listing per seller org + Grade Master (Catalog must reference gradeId).
    const existingActive = await this.prisma.product.findFirst({
      where: {
        organizationId: dto.organizationId,
        gradeId: dto.gradeId,
        deletedAt: null,
        status: ProductStatus.ACTIVE,
      },
      select: { id: true, code: true },
    });
    if (existingActive) {
      throw new BadRequestException(
        `This grade is already listed for this seller as ${existingActive.code}. Open the existing catalog listing instead of creating another.`,
      );
    }

    const product = await this.prisma.product.create({
      data: {
        organizationId: dto.organizationId,
        sellerProfileId: org.sellerProfile.id,
        gradeId: dto.gradeId,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        brand: dto.brand,
        manufacturer: dto.manufacturer,
        description: dto.description,
        unit: dto.unit ?? 'MT',
        status: ProductStatus.ACTIVE,
      },
      include: productInclude,
    });

    await this.audit.log({
      action: 'ADMIN_PRODUCT_CREATED',
      actorUserId,
      organizationId: dto.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: product.id,
      newData: { code: product.code, status: product.status, gradeId: dto.gradeId },
    });

    return withCatalogAggregates(product);
  }

  /**
   * Catalog Add Listing — mirrors seller createListing so Customer App/Web
   * Live Listings see ACTIVE product + ACTIVE marketplace offer when published.
   */
  async createListing(
    dto: AdminCreateMarketplaceListingDto,
    actorUserId: string,
  ) {
    if (!Number.isFinite(dto.moq) || dto.moq <= 0) {
      throw new BadRequestException('MOQ must be greater than zero');
    }
    if (!Number.isFinite(dto.sellingPrice) || dto.sellingPrice <= 0) {
      throw new BadRequestException('Selling price must be a positive number');
    }
    if (!Number.isFinite(dto.availableStock) || dto.availableStock < 0) {
      throw new BadRequestException(
        'Available stock must be a non-negative number',
      );
    }
    if (dto.moq > dto.availableStock) {
      throw new BadRequestException('MOQ cannot exceed available stock');
    }

    const org = await this.prisma.organization.findFirst({
      where: { id: dto.organizationId, deletedAt: null },
      include: { sellerProfile: true },
    });
    if (!org) throw new BadRequestException('Organization not found');
    if (!org.sellerProfile) {
      throw new BadRequestException(
        'organizationId must belong to a seller organization',
      );
    }

    const publish = dto.publishToMarketplace !== false;
    if (publish && org.sellerProfile.status !== SellerStatus.APPROVED) {
      throw new BadRequestException(
        'Only APPROVED sellers can publish listings to the customer marketplace',
      );
    }

    const grade = await this.prisma.grade.findFirst({
      where: {
        id: dto.gradeId,
        deletedAt: null,
        status: GradeStatus.ACTIVE,
      },
    });
    if (!grade) {
      throw new BadRequestException('Grade not found or inactive');
    }
    if (publish && !grade.customerVisible) {
      throw new BadRequestException(
        'This grade is not customer-visible. Enable Customer Visibility on Grade Master before publishing, or save as draft.',
      );
    }
    if (publish) {
      const review = assessMaterialPriceReview(dto.sellingPrice);
      if (review.needsPriceReview) {
        throw new BadRequestException(
          review.reason ??
            'Selling price is below the marketplace freight floor. Enter a realistic ₹/MT price so Customer App/Web can show this listing.',
        );
      }
    }

    if (publish) {
      const existingListing = await this.prisma.product.findFirst({
        where: {
          organizationId: dto.organizationId,
          gradeId: dto.gradeId,
          deletedAt: null,
          status: { not: ProductStatus.ARCHIVED },
        },
        select: { id: true, code: true, status: true },
      });
      if (existingListing) {
        throw new ConflictException({
          code: 'DUPLICATE_LISTING',
          message:
            existingListing.status === ProductStatus.ACTIVE
              ? `An active marketplace listing already exists for this grade (${existingListing.code}). Update that listing instead of creating a duplicate.`
              : `A ${existingListing.status} listing already exists for this grade (${existingListing.code}). Reactivate or update that listing instead.`,
          existingProductId: existingListing.id,
          existingProductCode: existingListing.code,
          existingProductStatus: existingListing.status,
        });
      }
    }

    const warehouse = await this.resolveListingWarehouse(
      dto.organizationId,
      dto,
    );
    const productCode = await this.allocateUniqueProductCode(
      dto.organizationId,
      dto.code,
    );
    const resolvedName = listingDisplayName(
      (dto.name ?? grade.fullGradeName ?? grade.displayName ?? grade.name).trim(),
      {
        fullGradeName: grade.fullGradeName,
        displayName: grade.displayName,
        gradeGroup: grade.gradeGroup,
        gradeNo: grade.gradeNo,
        name: grade.name,
      },
    );
    const resolvedManufacturer =
      dto.manufacturer?.trim() || grade.manufacturer?.trim() || undefined;
    const unit = dto.unit ?? 'MT';
    const stock = Number(dto.availableStock);
    const gstPercent =
      typeof dto.gstPercent === 'number' && Number.isFinite(dto.gstPercent)
        ? dto.gstPercent
        : 18;
    const productStatus = publish ? ProductStatus.ACTIVE : ProductStatus.DRAFT;
    const offerStatus = publish ? OfferStatus.ACTIVE : OfferStatus.DRAFT;
    const deliveryTerms =
      dto.deliveryTerms?.trim() ||
      estimateDeliveryTerms(warehouse.city ?? warehouse.name);
    const dispatchWindow =
      dto.dispatchWindow?.trim() || DEFAULT_DISPATCH_WINDOW;
    const priceReview = assessMaterialPriceReview(dto.sellingPrice);

    const result = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          organizationId: dto.organizationId,
          sellerProfileId: org.sellerProfile!.id,
          gradeId: dto.gradeId,
          code: productCode,
          name: resolvedName,
          brand: resolvedManufacturer,
          manufacturer: resolvedManufacturer,
          description: dto.notes,
          mfi: dto.mfi,
          density: dto.density,
          packaging: dto.packaging,
          unit,
          countryOfOrigin: dto.countryOfOrigin ?? 'India',
          supplyOrigin: dto.countryOfOrigin ?? 'India',
          status: productStatus,
          technicalSpecs: {
            ...(dto.application ? { application: dto.application } : {}),
            ...(dto.polymerType ? { polymerType: dto.polymerType } : {}),
            warehouseLabel: dto.warehouseName ?? warehouse.name,
            ...(dto.application ? { applications: [dto.application] } : {}),
            createdByAdmin: true,
          } as Prisma.InputJsonValue,
          metadata: {
            notes: dto.notes ?? null,
            reservedStock: dto.reservedStock ?? 0,
            gstPercent,
            gradeMasterCode: dto.code.trim().toUpperCase(),
            createdByAdmin: true,
          } as Prisma.InputJsonValue,
        },
      });

      const inventory = await tx.inventory.create({
        data: {
          organizationId: dto.organizationId,
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
          organizationId: dto.organizationId,
          sellerProfileId: org.sellerProfile!.id,
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
          deliveryTerms,
          status: offerStatus,
          visibility: 'MARKETPLACE',
          createdById: actorUserId,
          metadata: {
            gstPercent,
            dispatchWindow,
            needsPriceReview: priceReview.needsPriceReview,
            priceReviewReason: priceReview.reason,
            createdByAdmin: true,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        productId: product.id,
        offerId: offer.id,
        inventoryId: inventory.id,
      };
    });

    await this.audit.log({
      action: 'ADMIN_LISTING_CREATED',
      actorUserId,
      organizationId: dto.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: result.productId,
      newData: {
        listing: true,
        offerId: result.offerId,
        inventoryId: result.inventoryId,
        status: productStatus,
        published: publish,
        sellingPrice: dto.sellingPrice,
        gradeId: dto.gradeId,
      },
    });

    const product = await this.findOne(result.productId);
    return {
      ...product,
      offerId: result.offerId,
      inventoryId: result.inventoryId,
      warehouseId: warehouse.id,
      published: publish,
    };
  }

  private async allocateUniqueProductCode(
    organizationId: string,
    requested: string,
  ): Promise<string> {
    const base =
      requested
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'SKU';

    const existing = await this.prisma.product.findFirst({
      where: { organizationId, code: base },
      select: { id: true, deletedAt: true },
    });

    if (!existing) return base;

    if (existing.deletedAt) {
      await this.prisma.product.update({
        where: { id: existing.id },
        data: {
          code: `${base.slice(0, 28)}__DEL__${existing.id.replace(/-/g, '').slice(0, 8)}`,
        },
      });
      return base;
    }

    for (let i = 2; i < 100; i += 1) {
      const candidate = `${base}-${i}`.slice(0, 48);
      const hit = await this.prisma.product.findFirst({
        where: { organizationId, code: candidate },
        select: { id: true },
      });
      if (!hit) return candidate;
    }

    return `${base}-${Date.now().toString(36).toUpperCase()}`.slice(0, 48);
  }

  private async resolveListingWarehouse(
    organizationId: string,
    dto: AdminCreateMarketplaceListingDto,
  ) {
    if (dto.warehouseId) {
      const warehouse = await this.prisma.warehouse.findFirst({
        where: {
          id: dto.warehouseId,
          deletedAt: null,
          OR: [
            { organizationId },
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
            { organizationId },
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
      const code = `WH-${codeBase || 'ADMIN'}-${Date.now().toString(36).toUpperCase()}`;
      return this.prisma.warehouse.create({
        data: {
          organizationId,
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
        OR: [{ organizationId: null }, { organizationId }],
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

  async update(id: string, dto: AdminUpdateProductDto, actorUserId: string) {
    const existing = await this.findOne(id);
    const product = await this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        brand: dto.brand,
        manufacturer: dto.manufacturer,
        description: dto.description,
        unit: dto.unit,
      },
      include: productInclude,
    });

    await this.audit.log({
      action: 'ADMIN_PRODUCT_UPDATED',
      actorUserId,
      organizationId: existing.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
      previousData: { name: existing.name },
      newData: { name: product.name },
    });

    return product;
  }

  async updateStatus(
    id: string,
    dto: AdminUpdateProductStatusDto,
    actorUserId: string,
  ) {
    const existing = await this.findOne(id);
    // DTO Transform already maps legacy GradeStatus.INACTIVE → ProductStatus.PAUSED.
    const product = await this.prisma.product.update({
      where: { id },
      data: { status: dto.status },
      include: productInclude,
    });

    await this.audit.log({
      action: 'ADMIN_PRODUCT_STATUS_UPDATED',
      actorUserId,
      organizationId: existing.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
      previousData: { status: existing.status },
      newData: { status: dto.status },
    });

    return withCatalogAggregates(product);
  }

  /**
   * Soft-archive a product: set ARCHIVED + deletedAt, pause ACTIVE offers.
   * Preserves purchase_request / order / cart references. Reversible via restore.
   */
  async archive(
    id: string,
    actorUserId: string,
    reason = 'admin_product_archive',
  ) {
    const existing = await this.findOne(id);

    const result = await this.prisma.$transaction(async (tx) => {
      const activeOffers = await tx.offer.findMany({
        where: {
          productId: id,
          deletedAt: null,
          status: OfferStatus.ACTIVE,
        },
        select: { id: true, metadata: true },
      });

      for (const offer of activeOffers) {
        const prev =
          offer.metadata &&
          typeof offer.metadata === 'object' &&
          !Array.isArray(offer.metadata)
            ? (offer.metadata as Record<string, unknown>)
            : {};
        await tx.offer.update({
          where: { id: offer.id },
          data: {
            status: OfferStatus.PAUSED,
            metadata: {
              ...prev,
              pausedReason: reason,
              pausedAt: new Date().toISOString(),
            },
          },
        });
      }

      const product = await tx.product.update({
        where: { id },
        data: {
          status: ProductStatus.ARCHIVED,
          deletedAt: new Date(),
        },
        include: productInclude,
      });

      return { product, pausedOfferCount: activeOffers.length };
    });

    await this.audit.log({
      action: 'ADMIN_PRODUCT_ARCHIVED',
      actorUserId,
      organizationId: existing.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
      previousData: { status: existing.status, deletedAt: null },
      newData: {
        status: result.product.status,
        deletedAt: result.product.deletedAt,
        pausedOffers: result.pausedOfferCount,
        reason,
      },
    });

    return result;
  }

  /** Reverse archive for accidental removals (clears deletedAt, sets PAUSED). */
  async restore(id: string, actorUserId: string) {
    const existing = await this.prisma.product.findFirst({
      where: { id },
      include: productInclude,
    });
    if (!existing) throw new NotFoundException('Product not found');
    if (!existing.deletedAt && existing.status !== ProductStatus.ARCHIVED) {
      throw new BadRequestException('Product is not archived');
    }

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        deletedAt: null,
        status: ProductStatus.PAUSED,
      },
      include: productInclude,
    });

    await this.audit.log({
      action: 'ADMIN_PRODUCT_RESTORED',
      actorUserId,
      organizationId: existing.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
      previousData: {
        status: existing.status,
        deletedAt: existing.deletedAt,
      },
      newData: { status: product.status, deletedAt: null },
    });

    return product;
  }
}
