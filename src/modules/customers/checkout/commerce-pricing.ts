import { createHash } from 'node:crypto';
import { PaymentMethod, Prisma } from '../../../generated/prisma/client.js';
import { isPlatformCredit } from '../../payments/common/platform-credit.js';
import { mul, round2, toDecimal } from '../../payments/common/money.util.js';

export const COMMERCE_PRICING_ENGINE = 'petrotrade-commerce-v1';

export type CommercePricingConfig = {
  gstBps: number;
  freightPerMt: string;
  platformFee: string;
  insuranceAmount: string;
  advanceDiscountBps: number;
  quoteTtlMs: number;
  quantityIncrement: string;
  /**
   * Optional admin-configured absolute floor (₹/MT). When set, prices below
   * this value are flagged for review even if freight is lower.
   * Empty / unset = no absolute floor (freight comparison still applies).
   */
  minMaterialPricePerMt: string | null;
  /**
   * Optional admin-configured ceiling (₹/MT). When set, prices above this
   * value are flagged for review. Empty / unset = no ceiling.
   */
  maxMaterialPricePerMt: string | null;
};

export const DEFAULT_COMMERCE_PRICING: CommercePricingConfig = {
  gstBps: Number(process.env.COMMERCE_GST_BPS ?? 1800),
  freightPerMt: process.env.COMMERCE_FREIGHT_PER_MT ?? '1250',
  platformFee: process.env.COMMERCE_PLATFORM_FEE ?? '0',
  insuranceAmount: process.env.COMMERCE_INSURANCE_AMOUNT ?? '0',
  /** Platform-owned ADVANCE incentive. Does not change seller offer price. */
  advanceDiscountBps: Number(process.env.COMMERCE_ADVANCE_DISCOUNT_BPS ?? 500),
  quoteTtlMs: Number(process.env.COMMERCE_QUOTE_TTL_MS ?? 10 * 60 * 1000),
  quantityIncrement: process.env.COMMERCE_QTY_INCREMENT ?? '1',
  minMaterialPricePerMt: process.env.COMMERCE_MIN_MATERIAL_PRICE_PER_MT?.trim()
    ? process.env.COMMERCE_MIN_MATERIAL_PRICE_PER_MT
    : null,
  maxMaterialPricePerMt: process.env.COMMERCE_MAX_MATERIAL_PRICE_PER_MT?.trim()
    ? process.env.COMMERCE_MAX_MATERIAL_PRICE_PER_MT
    : null,
};

export type QuoteLineInput = {
  unitPrice: Prisma.Decimal | number | string;
  quantity: Prisma.Decimal | number | string;
  paymentMethod: PaymentMethod;
};

export type QuoteAmounts = {
  unitPrice: Prisma.Decimal;
  quantity: Prisma.Decimal;
  baseAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  freightAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  taxBps: number;
  platformFee: Prisma.Decimal;
  insuranceAmount: Prisma.Decimal;
  insuranceIncluded: boolean;
  totalAmount: Prisma.Decimal;
};

export function moneyString(value: Prisma.Decimal | number | string): string {
  return round2(value).toFixed(2);
}

export function unitPriceString(
  value: Prisma.Decimal | number | string,
): string {
  return toDecimal(value)
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(4);
}

export function platformDiscountBps(
  paymentMethod: PaymentMethod,
  config: CommercePricingConfig = DEFAULT_COMMERCE_PRICING,
): number {
  if (paymentMethod === PaymentMethod.ADVANCE) {
    return Math.max(0, config.advanceDiscountBps);
  }
  return 0;
}

export function calculateQuoteAmounts(
  input: QuoteLineInput,
  config: CommercePricingConfig = DEFAULT_COMMERCE_PRICING,
): QuoteAmounts {
  const quantity = toDecimal(input.quantity);
  const unitPrice = toDecimal(input.unitPrice);
  const baseAmount = round2(mul(unitPrice, quantity));
  const discountBps = platformDiscountBps(input.paymentMethod, config);
  const discountAmount = round2(baseAmount.times(discountBps).dividedBy(10000));
  const freightAmount = round2(mul(config.freightPerMt, quantity));
  const platformFee = round2(config.platformFee);
  const insuranceAmount = round2(config.insuranceAmount);
  const taxable = round2(
    baseAmount.minus(discountAmount).plus(freightAmount).plus(platformFee),
  );
  const taxAmount = round2(taxable.times(config.gstBps).dividedBy(10000));
  const totalAmount = round2(taxable.plus(taxAmount).plus(insuranceAmount));

  return {
    unitPrice,
    quantity,
    baseAmount,
    discountAmount,
    freightAmount,
    taxAmount,
    taxBps: config.gstBps,
    platformFee,
    insuranceAmount,
    insuranceIncluded: insuranceAmount.isZero(),
    totalAmount,
  };
}

export function buildPricingVersion(parts: {
  offerId: string;
  unitPrice: string;
  quantity: string;
  paymentMethod: string;
  taxBps: number;
  freightPerMt: string;
  discountBps: number;
  platformFee: string;
  insuranceAmount: string;
}): string {
  const canonical = [
    COMMERCE_PRICING_ENGINE,
    `offer=${parts.offerId}`,
    `unit=${parts.unitPrice}`,
    `qty=${parts.quantity}`,
    `pay=${parts.paymentMethod}`,
    `gst=${parts.taxBps}`,
    `freight=${parts.freightPerMt}`,
    `disc=${parts.discountBps}`,
    `fee=${parts.platformFee}`,
    `ins=${parts.insuranceAmount}`,
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export function assertQuantityRules(input: {
  quantity: Prisma.Decimal | number | string;
  moq: Prisma.Decimal | number | string | null | undefined;
  available: Prisma.Decimal | number | string | null | undefined;
  increment?: Prisma.Decimal | number | string | null;
}): void {
  const quantity = toDecimal(input.quantity);
  if (quantity.lte(0)) {
    throw Object.assign(new Error('INVALID_QUANTITY'), {
      code: 'INVALID_QUANTITY',
    });
  }
  const moq = input.moq == null ? new Prisma.Decimal(0) : toDecimal(input.moq);
  if (quantity.lt(moq)) {
    throw Object.assign(new Error('MOQ_NOT_MET'), { code: 'MOQ_NOT_MET' });
  }
  if (input.available != null && quantity.gt(toDecimal(input.available))) {
    throw Object.assign(new Error('INSUFFICIENT_INVENTORY'), {
      code: 'INSUFFICIENT_INVENTORY',
    });
  }
  const increment =
    input.increment == null || toDecimal(input.increment).lte(0)
      ? new Prisma.Decimal(1)
      : toDecimal(input.increment);
  const steps = quantity.minus(moq).dividedBy(increment);
  if (!steps.isInteger()) {
    throw Object.assign(new Error('INVALID_QUANTITY_INCREMENT'), {
      code: 'INVALID_QUANTITY_INCREMENT',
    });
  }
}

export function creditDoesNotChangeSellerPrice(
  paymentMethod: PaymentMethod,
): boolean {
  return isPlatformCredit(paymentMethod);
}

/**
 * ₹/kg from an authoritative ₹/MT unit price (1 MT = 1,000 kg).
 * Uses Decimal — never float division.
 */
export function pricePerKgFromMt(
  pricePerMt: Prisma.Decimal | number | string,
): Prisma.Decimal {
  return toDecimal(pricePerMt).dividedBy(1000);
}

export function pricePerMtFromKg(
  pricePerKg: Prisma.Decimal | number | string,
): Prisma.Decimal {
  return toDecimal(pricePerKg).times(1000);
}

/**
 * Reject null / non-positive unit prices. Never fall back to ₹0 / ₹10.
 */
export function assertSellableUnitPrice(
  unitPrice: Prisma.Decimal | number | string | null | undefined,
): Prisma.Decimal {
  if (unitPrice == null || unitPrice === '') {
    throw Object.assign(new Error('OFFER_PRICE_UNAVAILABLE'), {
      code: 'OFFER_PRICE_UNAVAILABLE',
    });
  }
  const price = toDecimal(unitPrice);
  if (!price.isFinite() || price.lte(0)) {
    throw Object.assign(new Error('OFFER_PRICE_UNAVAILABLE'), {
      code: 'OFFER_PRICE_UNAVAILABLE',
    });
  }
  return price;
}

/**
 * Soft commercial review flag — does not block checkout math, but offerings
 * that need review must not go ACTIVE / Best Value on the customer marketplace.
 * Material priced below platform freight/MT is commercially suspicious for
 * polymers (e.g. ₹10/MT with ₹1,250 freight). Optional admin min/max floors
 * also apply when COMMERCE_MIN/MAX_MATERIAL_PRICE_PER_MT are configured.
 */
export function assessMaterialPriceReview(
  materialPricePerMt: Prisma.Decimal | number | string,
  config: CommercePricingConfig = DEFAULT_COMMERCE_PRICING,
): {
  needsPriceReview: boolean;
  reason: string | null;
} {
  const price = toDecimal(materialPricePerMt);
  const freight = toDecimal(config.freightPerMt);
  if (!price.isFinite() || price.lte(0)) {
    return {
      needsPriceReview: true,
      reason: 'Material price is missing or not positive',
    };
  }
  if (config.minMaterialPricePerMt) {
    const min = toDecimal(config.minMaterialPricePerMt);
    if (min.gt(0) && price.lt(min)) {
      return {
        needsPriceReview: true,
        reason: `Material price (₹${moneyString(price)}/MT) is below the configured minimum (₹${moneyString(min)}/MT)`,
      };
    }
  }
  if (config.maxMaterialPricePerMt) {
    const max = toDecimal(config.maxMaterialPricePerMt);
    if (max.gt(0) && price.gt(max)) {
      return {
        needsPriceReview: true,
        reason: `Material price (₹${moneyString(price)}/MT) is above the configured maximum (₹${moneyString(max)}/MT)`,
      };
    }
  }
  if (freight.gt(0) && price.lt(freight)) {
    return {
      needsPriceReview: true,
      reason: `Material price (₹${moneyString(price)}/MT) is below platform freight (₹${moneyString(freight)}/MT)`,
    };
  }
  return { needsPriceReview: false, reason: null };
}

/**
 * Buyer-facing marketplace eligibility: positive price that does not need review.
 * Used to hide suspicious / test offers from live listings and Best Value.
 */
export function isMarketplaceEligibleMaterialPrice(
  materialPricePerMt: Prisma.Decimal | number | string | null | undefined,
  config: CommercePricingConfig = DEFAULT_COMMERCE_PRICING,
): boolean {
  if (materialPricePerMt == null || materialPricePerMt === '') return false;
  try {
    const price = assertSellableUnitPrice(materialPricePerMt);
    return !assessMaterialPriceReview(price, config).needsPriceReview;
  } catch {
    return false;
  }
}

/** Minimum ₹/MT a live marketplace offer may show (freight floor, or admin min). */
export function marketplaceMinSellablePricePerMt(
  config: CommercePricingConfig = DEFAULT_COMMERCE_PRICING,
): Prisma.Decimal {
  const freight = toDecimal(config.freightPerMt);
  const configured = config.minMaterialPricePerMt
    ? toDecimal(config.minMaterialPricePerMt)
    : new Prisma.Decimal(0);
  if (configured.gt(0) && freight.gt(0)) {
    return configured.gt(freight) ? configured : freight;
  }
  if (configured.gt(0)) return configured;
  if (freight.gt(0)) return freight;
  return new Prisma.Decimal('0.01');
}

export type CommercePricingBreakdown = {
  materialPricePerMT: string;
  freightPerMT: string;
  advanceDiscountPercent: number;
  gstPercent: number;
  quantityMT: string;
  materialSubtotal: string;
  freightTotal: string;
  discountAmount: string;
  taxableAmount: string;
  gstAmount: string;
  finalAmount: string;
  finalAmountPerMT: string;
  currency: string;
  pricingUnit: 'MT';
  offerId: string;
  priceVersion: string;
  paymentMethod: PaymentMethod;
  needsPriceReview: boolean;
  priceReviewReason: string | null;
};

/**
 * Single commercial breakdown for listing previews, estimates, and checkout.
 * All amounts come from calculateQuoteAmounts — do not recalculate on clients.
 */
export function buildCommercePricingBreakdown(input: {
  offerId: string;
  unitPrice: Prisma.Decimal | number | string;
  quantity: Prisma.Decimal | number | string;
  paymentMethod: PaymentMethod;
  currency?: string;
  config?: CommercePricingConfig;
}): CommercePricingBreakdown {
  const config = input.config ?? DEFAULT_COMMERCE_PRICING;
  const unitPrice = assertSellableUnitPrice(input.unitPrice);
  const amounts = calculateQuoteAmounts(
    {
      unitPrice,
      quantity: input.quantity,
      paymentMethod: input.paymentMethod,
    },
    config,
  );
  const discountBps = platformDiscountBps(input.paymentMethod, config);
  const taxable = round2(
    amounts.baseAmount
      .minus(amounts.discountAmount)
      .plus(amounts.freightAmount)
      .plus(amounts.platformFee),
  );
  const review = assessMaterialPriceReview(unitPrice, config);
  const priceVersion = buildPricingVersion({
    offerId: input.offerId,
    unitPrice: unitPriceString(amounts.unitPrice),
    quantity: amounts.quantity.toFixed(3),
    paymentMethod: input.paymentMethod,
    taxBps: amounts.taxBps,
    freightPerMt: config.freightPerMt,
    discountBps,
    platformFee: moneyString(amounts.platformFee),
    insuranceAmount: moneyString(amounts.insuranceAmount),
  });

  return {
    materialPricePerMT: unitPriceString(amounts.unitPrice),
    freightPerMT: moneyString(config.freightPerMt),
    advanceDiscountPercent: discountBps / 100,
    gstPercent: amounts.taxBps / 100,
    quantityMT: amounts.quantity.toFixed(3),
    materialSubtotal: moneyString(amounts.baseAmount),
    freightTotal: moneyString(amounts.freightAmount),
    discountAmount: moneyString(amounts.discountAmount),
    taxableAmount: moneyString(taxable),
    gstAmount: moneyString(amounts.taxAmount),
    finalAmount: moneyString(amounts.totalAmount),
    finalAmountPerMT: moneyString(
      amounts.quantity.gt(0)
        ? amounts.totalAmount.dividedBy(amounts.quantity)
        : 0,
    ),
    currency: (input.currency ?? 'INR').toUpperCase(),
    pricingUnit: 'MT',
    offerId: input.offerId,
    priceVersion,
    paymentMethod: input.paymentMethod,
    needsPriceReview: review.needsPriceReview,
    priceReviewReason: review.reason,
  };
}

/** Non-binding listing card preview at MOQ (ADVANCE assumptions). */
export function buildListingPricingPreview(input: {
  offerId: string;
  /** Loose input — validated/coerced inside before pricing. */
  unitPrice: unknown;
  moq: unknown;
  currency?: string | null;
}): CommercePricingBreakdown | null {
  try {
    const unitPrice = assertSellableUnitPrice(
      input.unitPrice as Prisma.Decimal | number | string | null | undefined,
    );
    const moq =
      input.moq == null || toDecimal(input.moq as Prisma.Decimal | number | string).lte(0)
        ? new Prisma.Decimal(1)
        : toDecimal(input.moq as Prisma.Decimal | number | string);
    return buildCommercePricingBreakdown({
      offerId: input.offerId,
      unitPrice,
      quantity: moq,
      paymentMethod: PaymentMethod.ADVANCE,
      currency: input.currency ?? 'INR',
    });
  } catch {
    return null;
  }
}
