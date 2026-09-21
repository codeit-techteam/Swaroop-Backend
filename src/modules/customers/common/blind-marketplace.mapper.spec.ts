import { PaymentMethod } from '../../../generated/prisma/client.js';
import { describe, expect, it } from 'vitest';
import {
  resolveOfferUnitPrice,
  toBlindOffer,
  toBlindProduct,
} from './blind-marketplace.mapper.js';

describe('blind marketplace mapper', () => {
  it('never exposes seller identity on products', () => {
    const payload = toBlindProduct({
      id: 'prod-1',
      code: 'HDPE-FL-002',
      name: 'HDPE Film',
      brand: 'PRIVATE',
      description: 'Film grade',
      technicalSpecs: { mfi: '0.36' },
      mfi: '0.36',
      density: null,
      packaging: '25kg bags',
      unit: 'MT',
      countryOfOrigin: 'IN',
      supplyOrigin: 'domestic',
      status: 'ACTIVE',
      grade: {
        id: 'grade-1',
        code: 'HDPE_FILM',
        name: 'HDPE Film',
        displayName: 'HDPE Film',
        category: { id: 'cat-1', code: 'HDPE', name: 'HDPE' },
      },
      offers: [
        {
          id: 'offer-1',
          quantity: 1000,
          moq: 20,
          unit: 'MT',
          basePrice: 137.45,
          currency: 'INR',
          deliveryTerms: '2-3 Days',
          organizationId: 'org-seller-secret',
        },
      ],
    });

    const json = JSON.stringify(payload);
    expect(payload.supplier.displayName).toBe('ANONYMOUS SUPPLIER');
    expect(json).not.toContain('org-seller-secret');
    expect(json).not.toContain('sellerId');
    expect(json).not.toContain('sellerName');
    expect(payload.listing?.price).toBe(137.45);
    expect(payload.listing?.moq).toBe(20);
  });

  it('never exposes seller identity on offers', () => {
    const payload = toBlindOffer({
      id: 'offer-1',
      referenceNumber: 'OFFER-1',
      quantity: 500,
      moq: 10,
      unit: 'MT',
      basePrice: 100,
      currency: 'INR',
      pricingBasis: null,
      paymentTerms: null,
      deliveryTerms: null,
      validFrom: null,
      validUntil: null,
      status: 'ACTIVE',
      organizationId: 'org-seller-secret',
    });
    const json = JSON.stringify(payload);
    expect(payload.supplier.displayName).toBe('ANONYMOUS SUPPLIER');
    expect(json).not.toContain('org-seller-secret');
    expect(payload.supplier.reference).toMatch(/^SUP-/);
  });

  it('ignores seller credit-specific price tiers', () => {
    const price = resolveOfferUnitPrice(
      {
        basePrice: 100000,
        priceTiers: [
          {
            minQty: 1,
            maxQty: null,
            price: 112500,
            paymentMethod: PaymentMethod.CREDIT_15,
          },
          {
            minQty: 1,
            maxQty: null,
            price: 100000,
            paymentMethod: null,
          },
        ],
      } as never,
      25,
    );
    expect(Number(price)).toBe(100000);
  });
});
