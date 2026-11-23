import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EntityOwnerType,
  GradeStatus,
  OfferStatus,
  Prisma,
  ProductStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { AdminAuditService } from '../common/admin-audit.service.js';
import type {
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
