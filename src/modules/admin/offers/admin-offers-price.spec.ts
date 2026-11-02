import { describe, expect, it } from 'vitest';
import {
  assessMaterialPriceReview,
  pricePerKgFromMt,
  pricePerMtFromKg,
  unitPriceString,
} from '../../customers/checkout/commerce-pricing.js';

describe('admin offer price corrections', () => {
  it('converts kg input to authoritative ₹/MT storage', () => {
    expect(unitPriceString(pricePerMtFromKg(98))).toBe('98000.0000');
    expect(unitPriceString(pricePerKgFromMt(98000))).toBe('98.0000');
  });

  it('flags the production ₹10/MT fixture as needing review vs freight', () => {
    const review = assessMaterialPriceReview(10);
    expect(review.needsPriceReview).toBe(true);
    expect(review.reason).toMatch(/below platform freight/i);
  });

  it('accepts a typical polymer market rate without review', () => {
    const review = assessMaterialPriceReview(98000);
    expect(review.needsPriceReview).toBe(false);
    expect(review.reason).toBeNull();
  });
});
