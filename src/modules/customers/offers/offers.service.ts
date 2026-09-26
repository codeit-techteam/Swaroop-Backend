import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { toBlindOffer } from '../common/blind-marketplace.mapper.js';
import { CustomerContextService } from '../common/customer-context.service.js';
import {
  activeMarketplaceOfferWhere,
  offerInclude,
} from '../marketplace/marketplace.service.js';
import type { CustomerOfferQueryDto } from './offers.dto.js';

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerContext: CustomerContextService,
  ) {}

  private async ctx(userId: string) {
    return this.customerContext.getOrCreateCustomer(userId);
  }

  private buildWhere(query: CustomerOfferQueryDto): Prisma.OfferWhereInput {
    const region = query.region?.trim();
    const and: Prisma.OfferWhereInput[] = [activeMarketplaceOfferWhere()];

    if (query.productId) and.push({ productId: query.productId });
    if (query.gradeId) and.push({ gradeId: query.gradeId });
    if (query.minPrice != null) {
      and.push({ basePrice: { gte: query.minPrice } });
    }
    if (query.maxPrice != null) {
      and.push({ basePrice: { lte: query.maxPrice } });
    }
    if (query.minMoq != null) {
      and.push({ moq: { gte: query.minMoq } });
    }
    if (query.maxMoq != null) {
      and.push({ moq: { lte: query.maxMoq } });
    }
    if (query.paymentMethod) {
      and.push({
        priceTiers: {
          some: { paymentMethod: query.paymentMethod as never },
        },
      });
    }
    if (region) {
      and.push({
        warehouse: {
          OR: [
            { city: { contains: region, mode: 'insensitive' } },
            { state: { contains: region, mode: 'insensitive' } },
          ],
        },
      });
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      and.push({
        OR: [
          { referenceNumber: { contains: search, mode: 'insensitive' } },
          { product: { name: { contains: search, mode: 'insensitive' } } },
          { product: { code: { contains: search, mode: 'insensitive' } } },
          { grade: { name: { contains: search, mode: 'insensitive' } } },
          { grade: { code: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }

    return { AND: and };
  }

  async findAll(userId: string, query: CustomerOfferQueryDto) {
    await this.ctx(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const where = this.buildWhere(query);

    const [total, items] = await this.prisma.$transaction([
      this.prisma.offer.count({ where }),
      this.prisma.offer.findMany({
        where,
        include: offerInclude,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take,
      }),
    ]);

    return {
      items: items.map((o) => toBlindOffer(o)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(userId: string, id: string) {
    await this.ctx(userId);
    const offer = await this.prisma.offer.findFirst({
      where: { id, ...activeMarketplaceOfferWhere() },
      include: offerInclude,
    });
    if (!offer) throw new NotFoundException('Offer not found');
    return toBlindOffer(offer);
  }
}
