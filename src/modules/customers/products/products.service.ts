import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DocumentCategory,
  DocumentStatus,
  EntityOwnerType,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../../master-data/common/pagination.js';
import { ProductDocumentsQueryService } from '../../documents/services/product-documents-query.service.js';
import { GradeTdsService } from '../../tds/grade-tds.service.js';
import {
  dedupeBlindProducts,
  toBlindOffer,
  toBlindProduct,
} from '../common/blind-marketplace.mapper.js';
import { CustomerContextService } from '../common/customer-context.service.js';
import {
  activeMarketplaceOfferWhere,
  buyableMarketplaceProductWhere,
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
    private readonly gradeTds: GradeTdsService,
  ) {}

  private async ctx(userId?: string | null) {
    if (!userId) return null;
    return this.customerContext.getOrCreateCustomer(userId);
  }

  async findAll(userId: string | null | undefined, query: CustomerProductQueryDto) {
    await this.ctx(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const search = resolveSearch(query);
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const where: Prisma.ProductWhereInput = {
      ...buyableMarketplaceProductWhere(),
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
                    {
                      fullGradeName: {
                        contains: search,
                        mode: 'insensitive',
                      },
                    },
                    {
                      manufacturer: {
                        contains: search,
                        mode: 'insensitive',
                      },
                    },
                    { gradeNo: { contains: search, mode: 'insensitive' } },
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

    // B-06: drop commercially identical cards (same grade/price/MOQ/origin/ETA).
    const itemsBlind = dedupeBlindProducts(items.map((p) => toBlindProduct(p)));
    return {
      items: itemsBlind,
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(userId: string | null | undefined, id: string) {
    await this.ctx(userId);
    const product = await this.prisma.product.findFirst({
      where: {
        ...buyableMarketplaceProductWhere(),
        OR: [{ id }, { code: { equals: id, mode: 'insensitive' } }],
      },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('Product not found');
    const blind = toBlindProduct(product);
    const [documents, gradeTds] = await Promise.all([
      this.productDocuments.listCustomerVisible(
        product.id,
        product.offers?.[0]?.id ?? null,
      ),
      this.gradeTds
        .listForProduct(product.id, { audience: 'customer' })
        .catch(() => null),
    ]);
    return { ...blind, documents, gradeTds };
  }

  /** Grade-library TDS for a marketplace product (synced by product → grade). */
  async listProductTdsDocuments(
    userId: string | null | undefined,
    productId: string,
  ) {
    await this.ctx(userId);
    const product = await this.prisma.product.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { id: productId },
          { code: { equals: productId, mode: 'insensitive' } },
        ],
      },
      select: { id: true, gradeId: true },
    });
    if (!product?.gradeId) throw new NotFoundException('Product not found');
    return this.gradeTds.listForProduct(product.id, { audience: 'customer' });
  }

  async listDocuments(userId: string | null | undefined, productId: string) {
    await this.ctx(userId);
    const product = await this.prisma.product.findFirst({
      where: {
        ...buyableMarketplaceProductWhere(),
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
        ...buyableMarketplaceProductWhere(),
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

  /**
   * Grade-level TDS library (independent of live offers / buyable products).
   * Only verified, active documents with stored files are returned.
   * Never invents documents or attaches another grade's file.
   */
  async listGradeTdsDocuments(
    userId: string | null | undefined,
    gradeId: string,
  ) {
    await this.ctx(userId);
    return this.gradeTds.listForGrade(gradeId);
  }

  async listOffers(
    userId: string | null | undefined,
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
