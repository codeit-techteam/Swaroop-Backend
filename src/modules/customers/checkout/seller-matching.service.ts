import { Injectable } from '@nestjs/common';
import {
  OfferStatus,
  Prisma,
  ProductStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { cmp, toDecimal } from '../../payments/common/money.util.js';
import {
  assertMarketplaceOffer,
  MarketplaceException,
  resolveOfferUnitPrice,
} from '../common/blind-marketplace.mapper.js';
import { CheckoutException } from './checkout.errors.js';
import { assertQuantityRules } from './commerce-pricing.js';

export type MatchStrategy = 'EXPLICIT_OFFER' | 'PRODUCT_BEST_PRICE' | 'GRADE_BEST_PRICE';

export const quoteOfferInclude = {
  product: {
    select: {
      id: true,
      code: true,
      name: true,
      packaging: true,
      unit: true,
      status: true,
      deletedAt: true,
      gradeId: true,
    },
  },
  grade: {
    select: { id: true, code: true, name: true, displayName: true },
  },
  warehouse: {
    select: { city: true, state: true, country: true },
  },
  priceTiers: { orderBy: { minQty: 'asc' as const } },
} satisfies Prisma.OfferInclude;

export type MatchedOffer = Prisma.OfferGetPayload<{
  include: typeof quoteOfferInclude;
}>;

export type SellerMatch = {
  offer: MatchedOffer;
  unitPrice: Prisma.Decimal | number | string;
  strategy: MatchStrategy;
};

type TxClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class SellerMatchingService {
  constructor(private readonly prisma: PrismaService) {}

  async match(input: {
    offerId?: string;
    productId?: string;
    quantity: number;
    increment?: string;
    tx?: TxClient;
  }): Promise<SellerMatch> {
    const db = input.tx ?? this.prisma;
    const quantity = input.quantity;

    if (input.offerId) {
      const offer = await this.loadOffer(db, input.offerId);
      this.assertOffer(offer, quantity, input.increment);
      return {
        offer,
        unitPrice: resolveOfferUnitPrice(offer, quantity),
        strategy: 'EXPLICIT_OFFER',
      };
    }

    if (!input.productId) {
      throw new CheckoutException(
        'OFFER_NOT_FOUND',
        'productId or offerId is required',
      );
    }

    const product = await db.product.findFirst({
      where: {
        deletedAt: null,
        status: ProductStatus.ACTIVE,
        OR: [
          { id: input.productId },
          { code: { equals: input.productId, mode: 'insensitive' } },
        ],
      },
      select: { id: true, gradeId: true },
    });
    if (!product) {
      throw new CheckoutException('PRODUCT_NOT_FOUND', 'Product not found');
    }

    const productOffers = await this.listActiveOffers(db, {
      productId: product.id,
    });
    const productMatch = this.pickBest(productOffers, quantity, input.increment);
    if (productMatch) {
      return { ...productMatch, strategy: 'PRODUCT_BEST_PRICE' };
    }

    const gradeOffers = await this.listActiveOffers(db, {
      gradeId: product.gradeId,
    });
    const gradeMatch = this.pickBest(gradeOffers, quantity, input.increment);
    if (gradeMatch) {
      return { ...gradeMatch, strategy: 'GRADE_BEST_PRICE' };
    }

    throw new CheckoutException(
      'NO_MATCHING_SELLER',
      'No active seller offer can fulfil this quantity',
    );
  }

  pickBest(
    offers: MatchedOffer[],
    quantity: number,
    increment?: string,
  ): Omit<SellerMatch, 'strategy'> | null {
    const ranked: Array<{ offer: MatchedOffer; unitPrice: Prisma.Decimal }> = [];
    for (const offer of offers) {
      try {
        this.assertOffer(offer, quantity, increment);
        ranked.push({
          offer,
          unitPrice: toDecimal(resolveOfferUnitPrice(offer, quantity)),
        });
      } catch {
        continue;
      }
    }
    ranked.sort((a, b) => {
      const price = cmp(a.unitPrice, b.unitPrice);
      if (price !== 0) return price;
      return Number(b.offer.quantity) - Number(a.offer.quantity);
    });
    const winner = ranked[0];
    return winner ?? null;
  }

  private assertOffer(
    offer: MatchedOffer,
    quantity: number,
    increment?: string,
  ) {
    try {
      assertMarketplaceOffer(offer, quantity, offer.moq);
      assertQuantityRules({
        quantity,
        moq: offer.moq,
        available: offer.quantity,
        increment,
      });
    } catch (err) {
      if (err instanceof MarketplaceException) {
        throw err;
      }
      const code = (err as { code?: string }).code;
      if (code) {
        throw new CheckoutException(code);
      }
      throw err;
    }
  }

  private async loadOffer(db: TxClient, offerId: string): Promise<MatchedOffer> {
    const offer = await db.offer.findFirst({
      where: { id: offerId, deletedAt: null },
      include: quoteOfferInclude,
    });
    if (!offer) {
      throw new CheckoutException('OFFER_NOT_FOUND', 'Offer not found');
    }
    if (offer.status !== OfferStatus.ACTIVE) {
      throw new CheckoutException('OFFER_INACTIVE', 'Offer is not active');
    }
    return offer;
  }

  private listActiveOffers(
    db: TxClient,
    where: { productId?: string; gradeId?: string },
  ) {
    const now = new Date();
    return db.offer.findMany({
      where: {
        deletedAt: null,
        status: OfferStatus.ACTIVE,
        OR: [{ visibility: 'MARKETPLACE' }, { visibility: null }],
        AND: [
          { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        ],
        ...(where.productId ? { productId: where.productId } : {}),
        ...(where.gradeId ? { gradeId: where.gradeId } : {}),
        product: {
          deletedAt: null,
          status: ProductStatus.ACTIVE,
        },
      },
      include: quoteOfferInclude,
      orderBy: { basePrice: 'asc' },
      take: 50,
    });
  }
}
