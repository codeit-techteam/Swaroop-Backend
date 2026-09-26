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
  toBlindOffer,
  toBlindProduct,
} from '../common/blind-marketplace.mapper.js';
import { CustomerContextService } from '../common/customer-context.service.js';
import type {
  MarketplaceHomeQueryDto,
  MarketplaceListQueryDto,
} from './marketplace.dto.js';

const customerGradeWhere: Prisma.GradeWhereInput = {
  deletedAt: null,
  status: GradeStatus.ACTIVE,
  customerVisible: true,
};

function activeMarketplaceOfferWhere(now = new Date()): Prisma.OfferWhereInput {
  return {
    deletedAt: null,
    status: OfferStatus.ACTIVE,
    OR: [{ visibility: 'MARKETPLACE' }, { visibility: null }],
    AND: [
      { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
      { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
    ],
    product: {
      deletedAt: null,
      status: ProductStatus.ACTIVE,
      grade: customerGradeWhere,
    },
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

const productInclude = {
  grade: {
    select: {
      id: true,
      code: true,
      name: true,
      displayName: true,
      category: { select: { id: true, code: true, name: true } },
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
    where: {
      deletedAt: null,
      status: OfferStatus.ACTIVE,
      OR: [{ visibility: 'MARKETPLACE' }, { visibility: null }],
    },
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
      priceTiers: {
        orderBy: { minQty: 'asc' as const },
        select: {
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
    select: { id: true, code: true, name: true, packaging: true, unit: true },
  },
  grade: {
    select: { id: true, code: true, name: true, displayName: true },
  },
  warehouse: {
    select: { city: true, state: true, country: true },
  },
  priceTiers: { orderBy: { minQty: 'asc' as const } },
} satisfies Prisma.OfferInclude;

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerContext: CustomerContextService,
  ) {}

  private async ctx(userId: string) {
    return this.customerContext.getOrCreateCustomer(userId);
  }

  async home(userId: string, query: MarketplaceHomeQueryDto) {
    await this.ctx(userId);
    const now = new Date();
    const featuredLimit = query.featuredLimit ?? 8;
    const offersLimit = query.offersLimit ?? 8;
    const gradesLimit = query.gradesLimit ?? 12;
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
        where: {
          deletedAt: null,
          status: ProductStatus.ACTIVE,
          grade: customerGradeWhere,
          offers: {
            some: {
              deletedAt: null,
              status: OfferStatus.ACTIVE,
              OR: [{ visibility: 'MARKETPLACE' }, { visibility: null }],
              AND: [
                { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
                { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
              ],
            },
          },
        },
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
        where: {
          deletedAt: null,
          status: ProductStatus.ACTIVE,
          grade: customerGradeWhere,
        },
      }),
      this.prisma.offer.count({ where: offerWhere }),
    ]);

    return {
      categories: categories.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        displayName: c.displayName ?? c.name,
        parentGroup: c.parentGroup,
        sortOrder: c.sortOrder,
        gradeCount: c._count.grades,
      })),
      popularGrades: popularGrades.map((g) => ({
        id: g.id,
        code: g.code,
        name: g.name,
        displayName: g.displayName ?? g.name,
        description: g.description,
        category: g.category
          ? {
              id: g.category.id,
              code: g.category.code,
              name: g.category.name,
              displayName: g.category.displayName ?? g.category.name,
              parentGroup: g.category.parentGroup,
            }
          : null,
      })),
      featuredProducts: featuredProducts.map((p) => toBlindProduct(p)),
      activeOffers: activeOffers.map((o) => toBlindOffer(o)),
      summary: {
        grades: gradeCount,
        products: productCount,
        offers: offerCount,
        categories: categories.length,
      },
    };
  }

  async listCategories(userId: string) {
    await this.ctx(userId);
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
    return categories.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      displayName: c.displayName ?? c.name,
      parentGroup: c.parentGroup,
      sortOrder: c.sortOrder,
      gradeCount: c._count.grades,
    }));
  }

  async listGrades(userId: string, query: MarketplaceListQueryDto) {
    await this.ctx(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const search = resolveSearch(query);
    const where: Prisma.GradeWhereInput = {
      ...customerGradeWhere,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
              { displayName: { contains: search, mode: 'insensitive' } },
              {
                category: {
                  name: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.grade.count({ where }),
      this.prisma.grade.findMany({
        where,
        select: gradeSelect,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip,
        take,
      }),
    ]);

    return {
      items: items.map((g) => ({
        id: g.id,
        code: g.code,
        name: g.name,
        displayName: g.displayName ?? g.name,
        description: g.description,
        category: g.category
          ? {
              id: g.category.id,
              code: g.category.code,
              name: g.category.name,
              displayName: g.category.displayName ?? g.category.name,
              parentGroup: g.category.parentGroup,
            }
          : null,
      })),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getGrade(userId: string, id: string) {
    await this.ctx(userId);
    const grade = await this.prisma.grade.findFirst({
      where: { id, ...customerGradeWhere },
      select: gradeSelect,
    });
    if (!grade) throw new NotFoundException('Grade not found');
    return {
      id: grade.id,
      code: grade.code,
      name: grade.name,
      displayName: grade.displayName ?? grade.name,
      description: grade.description,
      category: grade.category
        ? {
            id: grade.category.id,
            code: grade.category.code,
            name: grade.category.name,
            displayName: grade.category.displayName ?? grade.category.name,
            parentGroup: grade.category.parentGroup,
          }
        : null,
    };
  }

  async listGradeProducts(
    userId: string,
    gradeId: string,
    query: MarketplaceListQueryDto,
  ) {
    await this.getGrade(userId, gradeId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      status: ProductStatus.ACTIVE,
      gradeId,
      grade: customerGradeWhere,
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
      items: items.map((p) => toBlindProduct(p)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async listGradeOffers(
    userId: string,
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
  customerGradeWhere,
  offerInclude,
  productInclude,
};
