import { describe, expect, it } from 'vitest';
import {
  classifyCartValidation,
  isCartCheckoutReady,
} from './cart-validation.js';

describe('cart validation status', () => {
  it('returns OK when there are no issues', () => {
    expect(classifyCartValidation([])).toBe('OK');
    expect(isCartCheckoutReady('OK')).toBe(true);
  });

  it('returns PRICE_CHANGED without blocking checkout', () => {
    const status = classifyCartValidation(
      [{ code: 'PRICE_CHANGED' }],
      [
        {
          cartItemId: 'item-1',
          productId: 'prod-1',
          productName: 'PP Homopolymer Injection Grade',
          gradeName: 'H110MA',
          oldUnitPrice: 94500,
          newUnitPrice: 96000,
          quantity: 12,
          unit: 'MT',
        },
      ],
    );
    expect(status).toBe('PRICE_CHANGED');
    expect(isCartCheckoutReady(status)).toBe(true);
  });

  it('returns INVALID for MOQ and inventory issues', () => {
    expect(classifyCartValidation([{ code: 'QUANTITY_BELOW_MOQ' }])).toBe(
      'INVALID',
    );
    expect(
      classifyCartValidation([{ code: 'QUANTITY_EXCEEDS_AVAILABILITY' }]),
    ).toBe('INVALID');
    expect(isCartCheckoutReady('INVALID')).toBe(false);
  });

  it('prefers INVALID over PRICE_CHANGED when both exist', () => {
    expect(
      classifyCartValidation([
        { code: 'PRICE_CHANGED' },
        { code: 'OFFER_EXPIRED' },
      ]),
    ).toBe('INVALID');
  });
});
