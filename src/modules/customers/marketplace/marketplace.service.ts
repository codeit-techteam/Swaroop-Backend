import { Injectable, NotFoundException } from '@nestjs/common';
import {
  GradeStatus,
  MasterStatus,
  OfferStatus,
  Prisma,
  ProductStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../../master-data/common/pagination.js';
import {
  blindManufacturerLabel,
  dedupeBlindProducts,
  sanitizeBlindCode,
  sanitizeBlindDisplayName,
  toBlindOffer,
  toBlindProduct,
} from '../common/blind-marketplace.mapper.js';
import { CustomerContextService } from '../common/customer-context.service.js';
import { formatCategoryDisplayName } from '../../grades/common/category-label.js';
import {
  GRADE_SEARCH_CANDIDATE_CAP,
  buildGradeSearchWhere,
  parseGradeSearch,
  rankGradeCandidates,
} from '../../master-data/grades/grade-search.js';
import {
  DEFAULT_COMMERCE_PRICING,
  marketplaceMinSellablePricePerMt,
} from '../checkout/commerce-pricing.js';
import type {
  MarketplaceGradeQueryDto,
  MarketplaceHomeQueryDto,
  MarketplaceListQueryDto,
} from './marketplace.dto.js';
import { excludedTestProductWhere } from './excluded-test-products.js';
import {
  marketplaceCacheKey,
  marketplaceReadCache,
} from './marketplace-cache.js';

const customerGradeWhere: Prisma.GradeWhereInput = {
  deletedAt: null,
  status: GradeStatus.ACTIVE,
  customerVisible: true,
};

/**
 * Live marketplace offers must clear the commercial price floor so test /
 * invalid prices (e.g. ₹10/MT) never appear as Best Value to buyers.
 */
function marketplaceEligiblePriceWhere(): Prisma.OfferWhereInput {
  return {
    basePrice: {
      gte: marketplaceMinSellablePricePerMt(DEFAULT_COMMERCE_PRICING),
    },
  };
}

function activeMarketplaceOfferWhere(now = new Date()): Prisma.OfferWhereInput {
  return {
    deletedAt: null,
    status: OfferStatus.ACTIVE,
    OR: [{ visibility: 'MARKETPLACE' }, { visibility: null }],
    AND: [
      { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
      { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
      marketplaceEligiblePriceWhere(),
    ],
    product: {
      deletedAt: null,
      status: ProductStatus.ACTIVE,
      grade: customerGradeWhere,
      ...excludedTestProductWhere(),
    },
  };
}

/** Nested offer filter on product cards (validity window included). */
function liveMarketplaceOfferNestedWhere(
  now = new Date(),
): Prisma.OfferWhereInput {
  return {
    deletedAt: null,
    status: OfferStatus.ACTIVE,
    OR: [{ visibility: 'MARKETPLACE' }, { visibility: null }],
    AND: [
      { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
      { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
      marketplaceEligiblePriceWhere(),
    ],
  };
}

/** Products customers can buy: ACTIVE + live marketplace offer. */
function buyableMarketplaceProductWhere(
  now = new Date(),
): Prisma.ProductWhereInput {
  return {
    deletedAt: null,
    status: ProductStatus.ACTIVE,
    grade: customerGradeWhere,
    offers: { some: liveMarketplaceOfferNestedWhere(now) },
    ...excludedTestProductWhere(),
  };
}

const gradeSelect = {
  id: true,
  code: true,
  name: true,
  displayName: true,
  description: true,
  categoryId: true,
  sortOrder: true,
  status: true,
  gradeGroup: true,
  gradeNo: true,
  manufacturer: true,
  fullGradeName: true,
  inTodaysDelhiPriceList: true,
  category: {
    select: {
      id: true,
      code: true,
      name: true,
      displayName: true,
      parentGroup: true,
    },
  },
} satisfies Prisma.GradeSelect;

/** Customer-facing grade. Source.One reference prices stay admin-only. */
function toCustomerGrade(
  g: Prisma.GradeGetPayload<{ select: typeof gradeSelect }>,
  liveOfferCount?: number,
) {
  const rawName = g.name ?? '';
  const rawDisplay = g.displayName ?? g.name ?? '';
  const maker = g.manufacturer;
  return {
    id: g.id,
    code: sanitizeBlindCode(g.code, maker) ?? g.code,
    name: sanitizeBlindDisplayName(rawName, maker),
    displayName: sanitizeBlindDisplayName(rawDisplay, maker),
    description: g.description,
    gradeGroup: g.gradeGroup,
    gradeNo: g.gradeNo,
    manufacturer: blindManufacturerLabel(),
    fullGradeName: g.fullGradeName
      ? sanitizeBlindDisplayName(g.fullGradeName, maker)
      : g.fullGradeName,
    inTodaysDelhiPriceList: g.inTodaysDelhiPriceList,
    category: g.category
      ? {
          id: g.category.id,
          code: g.category.code,
          name: g.category.name,
          displayName: formatCategoryDisplayName(
            g.category.displayName,
            g.category.name,
            g.category.code,
          ),
          parentGroup: g.category.parentGroup,
        }
      : null,
    ...(liveOfferCount !== undefined
      ? { liveOfferCount, hasLiveOffers: liveOfferCount > 0 }
      : {}),
  };
}

const productInclude = {
  grade: {
    select: {
      id: true,
      code: true,
      name: true,
      displayName: true,
      fullGradeName: true,
      gradeNo: true,
      gradeGroup: true,
      manufacturer: true,
      hsnCode: true,
      applications: true,
      metadata: true,
      gradeApplications: {
        select: {
          application: { select: { name: true, code: true } },
        },
      },
      category: {
        select: { id: true, code: true, name: true, parentGroup: true },
      },
    },
  },
  media: {
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      type: true,
      sortOrder: true,
      fileName: true,
    },
  },
  offers: {
    where: liveMarketplaceOfferNestedWhere(),
    orderBy: { basePrice: 'asc' as const },
    take: 1,
    select: {
      id: true,
      quantity: true,
      moq: true,
      unit: true,
      basePrice: true,
      currency: true,
      deliveryTerms: true,
      paymentTerms: true,
      metadata: true,
      warehouse: {
        select: {
          id: true,
          name: true,
          city: true,
          state: true,
          country: true,
        },
      },
      priceTiers: {
        orderBy: { minQty: 'asc' as const },
        select: {
          id: true,
          minQty: true,
          maxQty: true,
          price: true,
          currency: true,
          paymentMethod: true,
        },
      },
    },
  },
} satisfies Prisma.ProductInclude;

const offerInclude = {
  product: {
    select: {
      id: true,
      code: true,
      name: true,
      packaging: true,
      unit: true,
      manufacturer: true,
      brand: true,
      technicalSpecs: true,
    },
  },
  grade: {
    select: {
      id: true,
      code: true,
      name: true,
      displayName: true,
      fullGradeName: true,
      gradeNo: true,
      gradeGroup: true,
      manufacturer: true,
      status: true,
      customerVisible: true,
      deletedAt: true,
    },
  },
  warehouse: {
    select: { city: true, state: true, country: true },
  },
  priceTiers: { orderBy: { minQty: 'asc' as const } },
} satisfies Prisma.OfferInclude;

function dedupeGradesById<T extends { id: string }>(grades: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const grade of grades) {
    if (seen.has(grade.id)) continue;
    seen.add(grade.id);
    out.push(grade);
  }
  return out;
}

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerContext: CustomerContextService,
  ) {}

  /** Optional: guests browse without creating a customer profile. */
  private async ctx(userId?: string | null) {
    if (!userId) return null;
    return this.customerContext.getOrCreateCustomer(userId);
  }

  async home(
    userId: string | null | undefined,
    query: MarketplaceHomeQueryDto,
  ) {
    await this.ctx(userId);
    const featuredLimit = query.featuredLimit ?? 8;
    const offersLimit = query.offersLimit ?? 8;
    const gradesLimit = query.gradesLimit ?? 12;
    // Guest home payloads are identical — cache briefly to cut DB load.
    const cacheKey = marketplaceCacheKey([
      'home',
      String(featuredLimit),
      String(offersLimit),
      String(gradesLimit),
      userId ? 'auth' : 'guest',
    ]);
    if (!userId) {
      const cached = marketplaceReadCache.get(cacheKey);
      if (cached) return cached as Awaited<ReturnType<MarketplaceService['home']>>;
    }

    const now = new Date();
    const offerWhere = activeMarketplaceOfferWhere(now);

    const [
      categories,
      popularGrades,
      featuredProducts,
      activeOffers,
      gradeCount,
      productCount,
      offerCount,
    ] = await Promise.all([
      this.prisma.gradeCategory.findMany({
        where: {
          deletedAt: null,
          status: MasterStatus.ACTIVE,
          isActive: true,
          grades: { some: customerGradeWhere },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          displayName: true,
          parentGroup: true,
          sortOrder: true,
          _count: {
            select: { grades: { where: customerGradeWhere } },
          },
        },
      }),
      this.prisma.grade.findMany({
        where: customerGradeWhere,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        take: gradesLimit,
        select: gradeSelect,
      }),
      this.prisma.product.findMany({
        where: buyableMarketplaceProductWhere(now),
        include: productInclude,
        orderBy: { createdAt: 'desc' },
        take: featuredLimit,
      }),
      this.prisma.offer.findMany({
        where: offerWhere,
        include: offerInclude,
        orderBy: { createdAt: 'desc' },
        take: offersLimit,
      }),
      this.prisma.grade.count({ where: customerGradeWhere }),
      this.prisma.product.count({
        where: buyableMarketplaceProductWhere(now),
      }),
      this.prisma.offer.count({ where: offerWhere }),
    ]);

    const payload = {
      categories: categories.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        displayName: formatCategoryDisplayName(c.displayName, c.name, c.code),
        parentGroup: c.parentGroup,
        sortOrder: c.sortOrder,
        gradeCount: c._count.grades,
      })),
      popularGrades: dedupeGradesById(popularGrades).map((g) =>
        toCustomerGrade(g),
      ),
      featuredProducts: dedupeBlindProducts(
        featuredProducts.map((p) => toBlindProduct(p)),
      ),
      activeOffers: activeOffers.map((o) => toBlindOffer(o)),
      summary: {
        grades: gradeCount,
        products: productCount,
        offers: offerCount,
        categories: categories.length,
      },
    };
    if (!userId) marketplaceReadCache.set(cacheKey, payload);
    return payload;
  }

  async listCategories(userId?: string | null) {
    await this.ctx(userId);
    const cacheKey = marketplaceCacheKey([
      'categories',
      userId ? 'auth' : 'guest',
    ]);
    if (!userId) {
      const cached = marketplaceReadCache.get(cacheKey);
      if (cached) return cached as Awaited<ReturnType<MarketplaceService['listCategories']>>;
    }
    const categories = await this.prisma.gradeCategory.findMany({
      where: {
        deletedAt: null,
        status: MasterStatus.ACTIVE,
        isActive: true,
        grades: { some: customerGradeWhere },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        displayName: true,
        parentGroup: true,
        sortOrder: true,
        _count: {
          select: { grades: { where: customerGradeWhere } },
        },
      },
    });
    const payload = categories.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      displayName: formatCategoryDisplayName(c.displayName, c.name, c.code),
      parentGroup: c.parentGroup,
      sortOrder: c.sortOrder,
      gradeCount: c._count.grades,
    }));
    if (!userId) marketplaceReadCache.set(cacheKey, payload);
    return payload;
  }

  async listGrades(
    userId: string | null | undefined,
    query: MarketplaceGradeQueryDto,
  ) {
    await this.ctx(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const search = resolveSearch(query);
    const searchWhere = buildGradeSearchWhere(search);
    const now = new Date();
    const where: Prisma.GradeWhereInput = {
      ...customerGradeWhere,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.category
        ? { category: { code: query.category.trim().toUpperCase() } }
        : {}),
      ...(query.gradeGroup
        ? {
            gradeGroup: {
              equals: query.gradeGroup.trim(),
              mode: 'insensitive',
            },
          }
        : {}),
      ...(query.manufacturer
        ? {
            manufacturer: {
              equals: query.manufacturer.trim(),
              mode: 'insensitive',
            },
          }
        : {}),
      ...(query.hasOffers
        ? { offers: { some: activeMarketplaceOfferWhere(now) } }
        : {}),
      ...(searchWhere ? { AND: [searchWhere] } : {}),
    };

    if (searchWhere && search) {
      return this.searchGradesRanked(
        where,
        search,
        { page, limit, skip, take },
        now,
      );
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.grade.count({ where }),
      this.prisma.grade.findMany({
        where,
        select: gradeSelect,
        orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
    ]);
    const offerCounts = await this.liveOfferCounts(
      items.map((g) => g.id),
      now,
    );

    return {
      items: items.map((g) => toCustomerGrade(g, offerCounts.get(g.id) ?? 0)),
      meta: paginationMeta(page, limit, total),
    };
  }

  /**
   * Relevance-ranked search. Matching happens in SQL (tokenised + aliases); ranking
   * is applied to the matched candidates, then the requested page is hydrated.
   * Catalogue grades without live offers are still returned (liveOfferCount: 0) —
   * only `hasOffers=true` narrows to grades with a live offer.
   */
  private async searchGradesRanked(
    where: Prisma.GradeWhereInput,
    search: string,
    paging: { page: number; limit: number; skip: number; take: number },
    now: Date,
  ) {
    const candidates = await this.prisma.grade.findMany({
      where,
      select: {
        id: true,
        code: true,
        gradeNo: true,
        name: true,
        displayName: true,
        fullGradeName: true,
        manufacturer: true,
        gradeGroup: true,
        description: true,
        sortOrder: true,
        category: { select: { code: true, name: true, displayName: true } },
        gradeApplications: {
          select: {
            application: { select: { name: true, displayName: true } },
          },
        },
      },
      take: GRADE_SEARCH_CANDIDATE_CAP,
    });
    const ranked = rankGradeCandidates(candidates, search);
    const total =
      candidates.length >= GRADE_SEARCH_CANDIDATE_CAP
        ? await this.prisma.grade.count({ where })
        : ranked.length;

    const pageIds = ranked
      .slice(paging.skip, paging.skip + paging.take)
      .map((c) => c.id);
    const rows = pageIds.length
      ? await this.prisma.grade.findMany({
          where: { id: { in: pageIds }, ...customerGradeWhere },
          select: gradeSelect,
        })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = pageIds
      .map((id) => byId.get(id))
      .filter((g): g is NonNullable<typeof g> => Boolean(g));
    const offerCounts = await this.liveOfferCounts(
      ordered.map((g) => g.id),
      now,
    );

    return {
      items: ordered.map((g) => toCustomerGrade(g, offerCounts.get(g.id) ?? 0)),
      meta: {
        ...paginationMeta(paging.page, paging.limit, total),
        // Echoed so clients can discard responses for an outdated query.
        query: parseGradeSearch(search)?.query ?? search,
      },
    };
  }

  async getGrade(userId: string | null | undefined, id: string) {
    await this.ctx(userId);
    const grade = await this.prisma.grade.findFirst({
      where: { id, ...customerGradeWhere },
      select: gradeSelect,
    });
    if (!grade) throw new NotFoundException('Grade not found');
    const offerCounts = await this.liveOfferCounts([grade.id]);
    return toCustomerGrade(grade, offerCounts.get(grade.id) ?? 0);
  }

  private async liveOfferCounts(gradeIds: string[], now = new Date()) {
    if (!gradeIds.length) return new Map<string, number>();
    const rows = await this.prisma.offer.groupBy({
      by: ['gradeId'],
      where: { ...activeMarketplaceOfferWhere(now), gradeId: { in: gradeIds } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.gradeId, r._count._all]));
  }

  async listGradeProducts(
    userId: string | null | undefined,
    gradeId: string,
    query: MarketplaceListQueryDto,
  ) {
    await this.getGrade(userId, gradeId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.ProductWhereInput = {
      ...buyableMarketplaceProductWhere(),
      gradeId,
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    return {
      items: dedupeBlindProducts(items.map((p) => toBlindProduct(p))),
      meta: paginationMeta(page, limit, total),
    };
  }

  async listGradeOffers(
    userId: string | null | undefined,
    gradeId: string,
    query: MarketplaceListQueryDto,
  ) {
    await this.getGrade(userId, gradeId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.OfferWhereInput = {
      ...activeMarketplaceOfferWhere(),
      gradeId,
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.offer.count({ where }),
      this.prisma.offer.findMany({
        where,
        include: offerInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    return {
      items: items.map((o) => toBlindOffer(o)),
      meta: paginationMeta(page, limit, total),
    };
  }
}

export {
  activeMarketplaceOfferWhere,
  buyableMarketplaceProductWhere,
  customerGradeWhere,
  liveMarketplaceOfferNestedWhere,
  offerInclude,
  productInclude,
};
