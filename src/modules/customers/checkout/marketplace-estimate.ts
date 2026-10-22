import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentMethod, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { resolveOfferUnitPrice } from '../common/blind-marketplace.mapper.js';
import {
  activeMarketplaceOfferWhere,
  offerInclude,
} from '../marketplace/marketplace.service.js';
import {
  assertQuantityRules,
  calculateQuoteAmounts,
  DEFAULT_COMMERCE_PRICING,
  moneyString,
  unitPriceString,
} from './commerce-pricing.js';

export type MarketplaceEstimateInput = {
  offerId: string;
  quantity: string;
  paymentMethod?: PaymentMethod;
};

/**
 * Non-binding landed-cost estimate from authoritative offer price.
 * Never converts foreign currencies to INR without a configured FX rate.
 */
export async function buildMarketplaceEstimate(
  prisma: PrismaService,
  dto: MarketplaceEstimateInput,
) {
  const offer = await prisma.offer.findFirst({
    where: { id: dto.offerId, ...activeMarketplaceOfferWhere() },
    include: offerInclude,
  });
  if (!offer) throw new NotFoundException('Offer not found');

  const paymentMethod = dto.paymentMethod ?? PaymentMethod.ADVANCE;
  const quantity = new Prisma.Decimal(dto.quantity);
  const unitPrice = resolveOfferUnitPrice(offer, Number(quantity));
  if (unitPrice == null) {
    throw new BadRequestException('Offer has no sellable unit price');
  }

  try {
    assertQuantityRules({
      quantity,
      moq: offer.moq,
      available: offer.quantity,
      increment: DEFAULT_COMMERCE_PRICING.quantityIncrement,
    });
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: string }).code)
        : 'INVALID_QUANTITY';
    throw new BadRequestException(code);
  }

  const currency = (offer.currency ?? 'INR').toUpperCase();
  const pricePerMt = unitPriceString(unitPrice);
  const pricePerKg = unitPriceString(
    new Prisma.Decimal(unitPrice).dividedBy(1000),
  );

  if (currency !== 'INR') {
    return {
      binding: false as const,
      currency,
      unitPricePerMt: pricePerMt,
      unitPricePerKg: pricePerKg,
      quantity: quantity.toString(),
      paymentMethod,
      note: 'Offer currency is not INR. No foreign→INR conversion without a configured exchange rate.',
      amounts: null,
      exTax: null,
      tax: null,
      inclusiveTotal: null,
    };
  }

  const amounts = calculateQuoteAmounts({
    unitPrice,
    quantity,
    paymentMethod,
  });

  return {
    binding: false as const,
    currency: 'INR',
    unitPricePerMt: pricePerMt,
    unitPricePerKg: pricePerKg,
    quantity: quantity.toString(),
    paymentMethod,
    amounts: null,
    exTax: {
      material: moneyString(amounts.baseAmount),
      discount: moneyString(amounts.discountAmount),
      freight: moneyString(amounts.freightAmount),
      platformFee: moneyString(amounts.platformFee),
      taxable: moneyString(
        amounts.baseAmount
          .minus(amounts.discountAmount)
          .plus(amounts.freightAmount)
          .plus(amounts.platformFee),
      ),
    },
    tax: {
      bps: amounts.taxBps,
      amount: moneyString(amounts.taxAmount),
    },
    inclusiveTotal: moneyString(amounts.totalAmount),
    note: 'Estimate only. Final checkout totals are recalculated server-side when you place an order.',
  };
}
