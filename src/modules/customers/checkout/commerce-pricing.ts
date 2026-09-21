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

export function unitPriceString(value: Prisma.Decimal | number | string): string {
  return toDecimal(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4);
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
    throw Object.assign(new Error('INVALID_QUANTITY'), { code: 'INVALID_QUANTITY' });
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
