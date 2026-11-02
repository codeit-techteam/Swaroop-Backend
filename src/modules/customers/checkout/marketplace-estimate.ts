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
  assertSellableUnitPrice,
  buildCommercePricingBreakdown,
  DEFAULT_COMMERCE_PRICING,
  moneyString,
  pricePerKgFromMt,
  unitPriceString,
  type CommercePricingBreakdown,
} from './commerce-pricing.js';

export type MarketplaceEstimateInput = {
  offerId: string;
  quantity: string;
  paymentMethod?: PaymentMethod;
};

/**
 * Non-binding landed-cost estimate from authoritative offer price.
 * Never converts foreign currencies to INR without a configured FX rate.
 * Clients must display breakdown fields as returned — do not recalculate.
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
  let unitPrice: Prisma.Decimal;
  try {
    unitPrice = assertSellableUnitPrice(
      resolveOfferUnitPrice(offer, Number(quantity)),
    );
  } catch {
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
  const pricePerKg = unitPriceString(pricePerKgFromMt(unitPrice));

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
      pricing: null as CommercePricingBreakdown | null,
      exTax: null,
      tax: null,
      inclusiveTotal: null,
    };
  }

  const pricing = buildCommercePricingBreakdown({
    offerId: offer.id,
    unitPrice,
    quantity,
    paymentMethod,
    currency,
  });

  return {
    binding: false as const,
    currency: 'INR',
    unitPricePerMt: pricing.materialPricePerMT,
    unitPricePerKg: pricePerKg,
    quantity: quantity.toString(),
    paymentMethod,
    /** Full commercial breakdown — single source of truth for UIs. */
    amounts: null,
    pricing,
    exTax: {
      material: pricing.materialSubtotal,
      discount: pricing.discountAmount,
      freight: pricing.freightTotal,
      platformFee: moneyString(DEFAULT_COMMERCE_PRICING.platformFee),
      taxable: pricing.taxableAmount,
    },
    tax: {
      bps: Math.round(pricing.gstPercent * 100),
      amount: pricing.gstAmount,
    },
    inclusiveTotal: pricing.finalAmount,
    note: 'Estimate only. Final checkout totals are recalculated server-side when you place an order.',
  };
}
