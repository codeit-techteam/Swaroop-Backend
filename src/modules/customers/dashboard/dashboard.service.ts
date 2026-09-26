import { Injectable } from '@nestjs/common';
import {
  Prisma,
  PurchaseRequestStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  PaginationQueryDto,
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
  buyableMarketplaceProductWhere,
  customerGradeWhere,
  offerInclude,
  productInclude,
} from '../marketplace/marketplace.service.js';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerContext: CustomerContextService,
  ) {}

  async summary(userId: string) {
    const ctx = await this.customerContext.getOrCreateCustomer(userId);
    const orgId = ctx.organizationId;
    const offerWhere = activeMarketplaceOfferWhere();

    const [
      cart,
      openPrs,
      approvedPrs,
      rejectedPrs,
      expiredPrs,
      marketplaceProducts,
      marketplaceOffers,
      visibleGrades,
    ] = await Promise.all([
      this.prisma.cart.findUnique({
        where: { customerProfileId: ctx.customerProfileId },
        include: { _count: { select: { items: true } } },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          customerOrgId: orgId,
          status: {
            in: [
              PurchaseRequestStatus.SOURCING,
              PurchaseRequestStatus.SUBMITTED,
              PurchaseRequestStatus.UNDER_REVIEW,
              PurchaseRequestStatus.NEGOTIATION,
              PurchaseRequestStatus.OFFER_RECEIVED,
              PurchaseRequestStatus.PENDING_APPROVAL,
            ],
          },
        },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          customerOrgId: orgId,
          status: PurchaseRequestStatus.APPROVED,
        },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          customerOrgId: orgId,
          status: PurchaseRequestStatus.REJECTED,
        },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          customerOrgId: orgId,
          status: PurchaseRequestStatus.EXPIRED,
        },
      }),
      this.prisma.product.count({
        where: buyableMarketplaceProductWhere(),
      }),
      this.prisma.offer.count({ where: offerWhere }),
      this.prisma.grade.count({ where: customerGradeWhere }),
    ]);

    return {
      customerProfileId: ctx.customerProfileId,
      organizationId: orgId,
      customerStatus: ctx.status,
      cart: {
        itemCount: cart?._count.items ?? 0,
      },
      purchaseRequests: {
        open: openPrs,
        approved: approvedPrs,
        rejected: rejectedPrs,
        expired: expiredPrs,
      },
      marketplace: {
        grades: visibleGrades,
        products: marketplaceProducts,
        offers: marketplaceOffers,
      },
    };
  }

  async search(userId: string, q: string, query: PaginationQueryDto) {
    await this.customerContext.getOrCreateCustomer(userId);
    const term = q?.trim() ?? '';
    const { page, limit, skip, take } = skipTake(query.page, query.limit);

    if (!term) {
      return {
        products: [],
        grades: [],
        offers: [],
        meta: paginationMeta(page, limit, 0),
      };
    }

    const productWhere: Prisma.ProductWhereInput = {
      ...buyableMarketplaceProductWhere(),
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { code: { contains: term, mode: 'insensitive' } },
        { brand: { contains: term, mode: 'insensitive' } },
      ],
    };

    const [productTotal, products, grades, offers] = await Promise.all([
      this.prisma.product.count({ where: productWhere }),
      this.prisma.product.findMany({
        where: productWhere,
        include: productInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.grade.findMany({
        where: {
          ...customerGradeWhere,
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { code: { contains: term, mode: 'insensitive' } },
            { displayName: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: Math.min(limit, 20),
        orderBy: { name: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          displayName: true,
          category: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.offer.findMany({
        where: {
          AND: [
            activeMarketplaceOfferWhere(),
            {
              OR: [
                { referenceNumber: { contains: term, mode: 'insensitive' } },
                {
                  product: {
                    name: { contains: term, mode: 'insensitive' },
                  },
                },
                {
                  grade: { name: { contains: term, mode: 'insensitive' } },
                },
              ],
            },
          ],
        },
        include: offerInclude,
        take: Math.min(limit, 20),
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      products: products.map((p) => toBlindProduct(p)),
      grades: grades.map((g) => ({
        id: g.id,
        code: g.code,
        name: g.name,
        displayName: g.displayName ?? g.name,
        category: g.category,
      })),
      offers: offers.map((o) => toBlindOffer(o)),
      meta: paginationMeta(page, limit, productTotal),
    };
  }
}
