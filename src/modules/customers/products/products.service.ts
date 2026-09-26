import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../../master-data/common/pagination.js';
import { ProductDocumentsQueryService } from '../../documents/services/product-documents-query.service.js';
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
    private readonly productDocuments: ProductDocumentsQueryService,
  ) {}

  private async ctx(userId: string) {
    return this.customerContext.getOrCreateCustomer(userId);
  }

  async findAll(userId: string, query: CustomerProductQueryDto) {
    await this.ctx(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const search = resolveSearch(query);
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
              { mfi: { contains: search, mode: 'insensitive' } },
              {
                grade: {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { code: { contains: search, mode: 'insensitive' } },
                    { displayName: { contains: search, mode: 'insensitive' } },
                  ],
                },
              },
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
        deletedAt: null,
        status: ProductStatus.ACTIVE,
        grade: customerGradeWhere,
        OR: [{ id }, { code: { equals: id, mode: 'insensitive' } }],
      },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('Product not found');
    const blind = toBlindProduct(product);
    const documents = await this.productDocuments.listCustomerVisible(
      product.id,
      product.offers?.[0]?.id ?? null,
    );
    return { ...blind, documents };
  }

  async listDocuments(userId: string, productId: string) {
    await this.ctx(userId);
    const product = await this.prisma.product.findFirst({
      where: {
        deletedAt: null,
        status: ProductStatus.ACTIVE,
        grade: customerGradeWhere,
        OR: [
          { id: productId },
          { code: { equals: productId, mode: 'insensitive' } },
        ],
      },
      include: {
        offers: {
          where: {
            deletedAt: null,
            status: 'ACTIVE',
          },
          take: 1,
          select: { id: true },
          orderBy: { basePrice: 'asc' },
        },
      },
    });
    if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');
    return this.productDocuments.listCustomerVisible(
      product.id,
      product.offers?.[0]?.id ?? null,
    );
  }

  async documentUrl(userId: string, productId: string, documentId: string) {
    await this.ctx(userId);
    const product = await this.prisma.product.findFirst({
      where: {
        deletedAt: null,
        status: ProductStatus.ACTIVE,
        grade: customerGradeWhere,
        OR: [
          { id: productId },
          { code: { equals: productId, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');
    return this.productDocuments.customerDownloadUrl(product.id, documentId);
  }

  async listOffers(
    userId: string,
    productId: string,
    query: CustomerProductQueryDto,
  ) {
    const product = await this.findOne(userId, productId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.OfferWhereInput = {
      ...activeMarketplaceOfferWhere(),
      productId: product.id,
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
