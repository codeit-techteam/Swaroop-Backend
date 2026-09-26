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

  it('ignores soft-deactivated price tiers from offer metadata', () => {
    const price = resolveOfferUnitPrice(
      {
        basePrice: 95000,
        metadata: { inactivePriceTier: ['tier-inactive'] },
        priceTiers: [
          {
            id: 'tier-inactive',
            minQty: 1,
            maxQty: 100,
            price: 80000,
            paymentMethod: null,
          },
          {
            id: 'tier-active',
            minQty: 1,
            maxQty: 100,
            price: 92000,
            paymentMethod: null,
          },
        ],
      } as never,
      25,
    );
    expect(Number(price)).toBe(92000);
  });

  it('exposes seller price tiers on blind product listings', () => {
    const payload = toBlindProduct({
      id: 'prod-2',
      code: 'PP-INJ-01',
      name: 'PP Injection',
      brand: 'PRIVATE',
      description: null,
      technicalSpecs: null,
      mfi: null,
      density: null,
      packaging: '25kg bags',
      unit: 'MT',
      countryOfOrigin: 'IN',
      supplyOrigin: 'domestic',
      status: 'ACTIVE',
      offers: [
        {
          id: 'offer-2',
          quantity: 500,
          moq: 10,
          unit: 'MT',
          basePrice: 90000,
          currency: 'INR',
          deliveryTerms: '2-3 Days',
          metadata: { inactivePriceTier: ['gone'] },
          priceTiers: [
            {
              id: 'gone',
              minQty: 1,
              maxQty: 9,
              price: 91000,
            },
            {
              id: 'keep',
              minQty: 10,
              maxQty: null,
              price: 88000,
            },
          ],
        },
      ],
    });

    expect(payload.listing?.priceTiers).toEqual([
      { minQty: 10, maxQty: null, price: 88000, currency: 'INR' },
    ]);
  });
});
