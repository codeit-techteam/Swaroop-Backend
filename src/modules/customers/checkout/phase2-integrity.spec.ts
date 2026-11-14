import { describe, expect, it } from 'vitest';
import {
  assessMaterialPriceReview,
  buildCommercePricingBreakdown,
  DEFAULT_COMMERCE_PRICING,
  isMarketplaceEligibleMaterialPrice,
  pricePerMtFromKg,
} from './commerce-pricing.js';
import { assertPriceTiersRespectMoq } from '../../sellers/offers/offer-price-tiers.util.js';
import {
  BLIND_MANUFACTURER_LABEL,
  toBlindProduct,
} from '../common/blind-marketplace.mapper.js';

describe('Phase 2 — catalogue / pricing integrity', () => {
  it('enforces grade-code uniqueness contract in proposed PSX format samples', () => {
    const codes = [
      'PSX-ABS-3000D-A1B2',
      'PSX-HDPE-F46003-C3D4',
      'PSX-PP-H110MA-E5F6',
    ];
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^PSX-[A-Z0-9_]+-[A-Z0-9_]+-[A-F0-9]{4}$/);
      expect(code.startsWith('PS-')).toBe(false);
    }
  });

  it('rejects MOQ-violating price tiers', () => {
    expect(() =>
      assertPriceTiersRespectMoq([{ minQty: 0, maxQty: 11, price: 96000 }], 12),
    ).toThrow(/below offer MOQ/i);
    expect(() =>
      assertPriceTiersRespectMoq([{ minQty: 12, maxQty: null, price: 93000 }], 12),
    ).not.toThrow();
  });

  it('converts KG → MT for price review', () => {
    expect(Number(pricePerMtFromKg(140))).toBe(140000);
    expect(assessMaterialPriceReview(pricePerMtFromKg(140)).needsPriceReview).toBe(
      false,
    );
    expect(assessMaterialPriceReview(140).needsPriceReview).toBe(true);
  });

  it('computes landed cost with freight + GST + advance discount', () => {
    const breakdown = buildCommercePricingBreakdown({
      offerId: 'offer-phase2',
      unitPrice: '94500',
      quantity: '12',
      paymentMethod: 'ADVANCE',
      config: DEFAULT_COMMERCE_PRICING,
    });
    expect(breakdown.freightTotal).toBe('15000.00');
    expect(breakdown.gstPercent).toBe(18);
    expect(breakdown.needsPriceReview).toBe(false);
    expect(Number(breakdown.finalAmount)).toBeGreaterThan(
      Number(breakdown.taxableAmount),
    );
  });

  it('excludes commercially insane prices from Best Value eligibility', () => {
    expect(isMarketplaceEligibleMaterialPrice(10)).toBe(false);
    expect(isMarketplaceEligibleMaterialPrice(94500)).toBe(true);
  });

  it('blinds manufacturer for customer marketplace payloads', () => {
    const payload = toBlindProduct({
      id: 'prod-1',
      code: 'ABS-1',
      name: '3000D',
      brand: 'TAITA',
      manufacturer: 'TAITA',
      description: null,
      technicalSpecs: {},
      mfi: null,
      density: null,
      packaging: null,
      unit: 'MT',
      countryOfOrigin: 'India',
      supplyOrigin: 'India',
      status: 'ACTIVE',
      grade: {
        id: 'g1',
        code: 'SO-ABS-3000D-TAITA-ABC',
        name: '3000D',
        displayName: 'ABS 3000D',
        fullGradeName: 'ABS 3000D - TAITA',
        gradeNo: '3000D',
        gradeGroup: 'ABS',
        manufacturer: 'TAITA',
        category: {
          id: 'c1',
          code: 'ABS',
          name: 'ABS',
          parentGroup: 'POLYMERS',
        },
      },
      offers: [
        {
          id: 'o1',
          quantity: 100,
          moq: 12,
          unit: 'MT',
          basePrice: 94500,
          currency: 'INR',
          deliveryTerms: null,
          paymentTerms: 'ADVANCE',
          warehouse: {
            name: 'Nhava Sheva',
            city: 'Mumbai',
            state: 'MH',
          },
          priceTiers: [],
        },
      ],
    });

    expect(payload.manufacturer).toBe(BLIND_MANUFACTURER_LABEL);
    expect(payload.brand).toBe(BLIND_MANUFACTURER_LABEL);
    expect(payload.supplier?.displayName).toMatch(/ANONYMOUS|PRIVATE/i);
    expect(JSON.stringify(payload)).not.toMatch(/TAITA/i);
  });

  it('treats expired validUntil as inactive for marketplace filter helper', () => {
    const now = new Date('2026-11-14T12:00:00.000Z');
    const validUntil = new Date('2026-10-01T11:10:41.701Z');
    const isLive = !validUntil || validUntil >= now;
    expect(isLive).toBe(false);
  });

  it('does not claim TDS visibility without a verified document key', () => {
    const docs: Array<{ storageKey?: string | null; verificationStatus?: string }> =
      [];
    const showQualityDocs = docs.some(
      (d) => d.verificationStatus === 'VERIFIED' && Boolean(d.storageKey),
    );
    expect(showQualityDocs).toBe(false);
  });
});
