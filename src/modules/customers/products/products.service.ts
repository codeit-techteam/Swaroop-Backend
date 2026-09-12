import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import {
  toBlindOffer,
  toBlindProduct,
} from '../common/blind-marketplace.mapper.js';
import { CustomerContextService } from '../common/customer-context.service.js';
import {
  activeMarketplaceOfferWhere,
  customerGradeWhere,
  offerInclude,
  productInclude,
} from '../marketplace/marketplace.service.js';
import type { CustomerProductQueryDto } from './products.dto.js';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerContext: CustomerContextService,
  ) {}

  private async ctx(userId: string) {
    return this.customerContext.requireCustomer(userId);
  }

  async findAll(userId: string, query: CustomerProductQueryDto) {
    await this.ctx(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const search = query.search?.trim();
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      status: ProductStatus.ACTIVE,
      grade: {
        ...customerGradeWhere,
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      },
      ...(query.gradeId ? { gradeId: query.gradeId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
              { brand: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take,
      }),
    ]);

    return {
      items: items.map((p) => toBlindProduct(p)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(userId: string, id: string) {
    await this.ctx(userId);
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        deletedAt: null,
        status: ProductStatus.ACTIVE,
        grade: customerGradeWhere,
      },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('Product not found');
    return toBlindProduct(product);
  }

  async listOffers(
    userId: string,
    productId: string,
    query: CustomerProductQueryDto,
  ) {
    await this.findOne(userId, productId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.OfferWhereInput = {
      ...activeMarketplaceOfferWhere(),
      productId,
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
