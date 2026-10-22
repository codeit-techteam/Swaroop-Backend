import { PaymentMethod, Prisma } from '../../../generated/prisma/client.js';
import { describe, expect, it } from 'vitest';
import {
  assertQuantityRules,
  buildPricingVersion,
  calculateQuoteAmounts,
  platformDiscountBps,
  pricePerKgFromMt,
  pricePerMtFromKg,
  unitPriceString,
} from './commerce-pricing.js';

describe('commerce pricing', () => {
  it('keeps seller unit price unchanged and applies platform ADVANCE discount', () => {
    const amounts = calculateQuoteAmounts({
      unitPrice: '101200',
      quantity: 25,
      paymentMethod: PaymentMethod.ADVANCE,
    });
    expect(amounts.unitPrice.toFixed(4)).toBe('101200.0000');
    expect(amounts.baseAmount.toFixed(2)).toBe('2530000.00');
    expect(amounts.discountAmount.toFixed(2)).toBe('126500.00');
    expect(amounts.freightAmount.toFixed(2)).toBe('31250.00');
    expect(Number(amounts.taxAmount)).toBeGreaterThan(0);
    expect(
      amounts.totalAmount.gt(amounts.baseAmount.minus(amounts.discountAmount)),
    ).toBe(true);
  });

  it('does not add seller credit surcharge on CREDIT_15 / CREDIT_30', () => {
    const advance = calculateQuoteAmounts({
      unitPrice: '100000',
      quantity: 10,
      paymentMethod: PaymentMethod.ADVANCE,
    });
    const credit = calculateQuoteAmounts({
      unitPrice: '100000',
      quantity: 10,
      paymentMethod: PaymentMethod.CREDIT_15,
    });
    expect(platformDiscountBps(PaymentMethod.CREDIT_15)).toBe(0);
    expect(credit.unitPrice.toFixed(4)).toBe(advance.unitPrice.toFixed(4));
    expect(credit.discountAmount.toFixed(2)).toBe('0.00');
    expect(credit.baseAmount.toFixed(2)).toBe(advance.baseAmount.toFixed(2));
  });

  it('builds a stable pricing version for the same commercial inputs', () => {
    const a = buildPricingVersion({
      offerId: 'offer-1',
      unitPrice: '101200.0000',
      quantity: '25.000',
      paymentMethod: 'ADVANCE',
      taxBps: 1800,
      freightPerMt: '1250',
      discountBps: 500,
      platformFee: '0.00',
      insuranceAmount: '0.00',
    });
    const b = buildPricingVersion({
      offerId: 'offer-1',
      unitPrice: '101200.0000',
      quantity: '25.000',
      paymentMethod: 'ADVANCE',
      taxBps: 1800,
      freightPerMt: '1250',
      discountBps: 500,
      platformFee: '0.00',
      insuranceAmount: '0.00',
    });
    const changed = buildPricingVersion({
      offerId: 'offer-1',
      unitPrice: '102000.0000',
      quantity: '25.000',
      paymentMethod: 'ADVANCE',
      taxBps: 1800,
      freightPerMt: '1250',
      discountBps: 500,
      platformFee: '0.00',
      insuranceAmount: '0.00',
    });
    expect(a).toBe(b);
    expect(changed).not.toBe(a);
  });

  it('validates MOQ, increment and inventory', () => {
    expect(() =>
      assertQuantityRules({
        quantity: 25,
        moq: 25,
        available: 100,
        increment: 1,
      }),
    ).not.toThrow();
    try {
      assertQuantityRules({
        quantity: 10,
        moq: 25,
        available: 100,
        increment: 1,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('MOQ_NOT_MET');
    }
    try {
      assertQuantityRules({
        quantity: 26,
        moq: 25,
        available: 100,
        increment: 5,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as { code?: string }).code).toBe(
        'INVALID_QUANTITY_INCREMENT',
      );
    }
    try {
      assertQuantityRules({
        quantity: 40,
        moq: 25,
        available: 30,
        increment: 1,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('INSUFFICIENT_INVENTORY');
    }
    expect(new Prisma.Decimal(25).isInteger()).toBe(true);
  });

  it('rejects zero and negative quantities', () => {
    for (const quantity of [0, -1, '-5', '0']) {
      try {
        assertQuantityRules({
          quantity,
          moq: 0,
          available: 100,
          increment: 1,
        });
        throw new Error(`expected throw for quantity=${quantity}`);
      } catch (err) {
        expect((err as { code?: string }).code).toBe('INVALID_QUANTITY');
      }
    }
  });

  it('converts ₹/MT ↔ ₹/kg with decimal-safe arithmetic (148000 → 148)', () => {
    const perKg = pricePerKgFromMt('148000');
    expect(unitPriceString(perKg)).toBe('148.0000');
    expect(unitPriceString(pricePerMtFromKg(perKg))).toBe('148000.0000');
    // Odd MT prices keep precision (no float drift).
    expect(unitPriceString(pricePerKgFromMt('148001.50'))).toBe('148.0015');
  });
});
