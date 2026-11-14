import {
  assertNonOverlappingPriceTiers,
  assertPriceTiersRespectMoq,
  resolveOfferValidityWindow,
} from './offer-price-tiers.util.js';

describe('assertNonOverlappingPriceTiers', () => {
  it('accepts non-overlapping slabs including open-ended max', () => {
    expect(() =>
      assertNonOverlappingPriceTiers([
        { minQty: 20, maxQty: 49, price: 108 },
        { minQty: 50, maxQty: 99, price: 106 },
        { minQty: 100, maxQty: null, price: 104 },
      ]),
    ).not.toThrow();
  });

  it('rejects overlapping ranges', () => {
    expect(() =>
      assertNonOverlappingPriceTiers([
        { minQty: 20, maxQty: 50, price: 108 },
        { minQty: 40, maxQty: 70, price: 106 },
      ]),
    ).toThrow(/overlap/i);
  });

  it('rejects invalid min/max/price', () => {
    expect(() =>
      assertNonOverlappingPriceTiers([{ minQty: 0, maxQty: 10, price: 100 }]),
    ).toThrow(/minQuantity/i);
    expect(() =>
      assertNonOverlappingPriceTiers([{ minQty: 10, maxQty: 5, price: 100 }]),
    ).toThrow(/maxQuantity/i);
    expect(() =>
      assertNonOverlappingPriceTiers([{ minQty: 10, maxQty: 20, price: 0 }]),
    ).toThrow(/price/i);
  });
});

describe('assertPriceTiersRespectMoq', () => {
  it('rejects tiers that start below MOQ', () => {
    expect(() =>
      assertPriceTiersRespectMoq(
        [{ minQty: 0, maxQty: 11, price: 96000 }],
        12,
      ),
    ).toThrow(/below offer MOQ/i);
    expect(() =>
      assertPriceTiersRespectMoq(
        [{ minQty: 5, maxQty: 11, price: 96000 }],
        12,
      ),
    ).toThrow(/below offer MOQ/i);
  });

  it('accepts tiers at or above MOQ', () => {
    expect(() =>
      assertPriceTiersRespectMoq(
        [
          { minQty: 12, maxQty: 24, price: 96000 },
          { minQty: 25, maxQty: null, price: 94000 },
        ],
        12,
      ),
    ).not.toThrow();
  });
});

describe('resolveOfferValidityWindow', () => {
  it('calculates validFrom/validUntil from server time + validityHours', () => {
    const now = new Date('2026-09-25T10:00:00.000Z');
    const window = resolveOfferValidityWindow({ validityHours: 24, now });
    expect(window.validFrom?.toISOString()).toBe('2026-09-25T10:00:00.000Z');
    expect(window.validUntil?.toISOString()).toBe('2026-09-26T10:00:00.000Z');
  });

  it('prefers validityHours over client-provided timestamps', () => {
    const now = new Date('2026-09-25T10:00:00.000Z');
    const window = resolveOfferValidityWindow({
      validityHours: 12,
      validFrom: '2020-01-01T00:00:00.000Z',
      validUntil: '2020-01-02T00:00:00.000Z',
      now,
    });
    expect(window.validUntil?.toISOString()).toBe('2026-09-25T22:00:00.000Z');
  });
});
