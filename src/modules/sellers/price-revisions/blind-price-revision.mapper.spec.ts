import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_SELLER_IDENTITY_MARKERS,
  anonymousBuyer,
  toBlindSellerPriceRevision,
} from './blind-price-revision.mapper.js';

describe('blind marketplace seller price revision DTO', () => {
  it('never exposes customer identity fields', () => {
    const customerOrgId = 'customer-org-secret-uuid-abc123';
    const dto = toBlindSellerPriceRevision({
      id: 'rev-1',
      offerId: null,
      purchaseRequestId: 'pr-1',
      previousPrice: 108,
      proposedPrice: 104,
      currency: 'INR',
      reason: 'Buyer requested revision',
      status: 'PENDING',
      metadata: null,
      createdAt: new Date('2026-09-10T10:00:00Z'),
      updatedAt: new Date('2026-09-10T10:00:00Z'),
      purchaseRequest: {
        id: 'pr-1',
        referenceNumber: 'PR-2026-00128',
        customerOrgId,
        currency: 'INR',
        paymentMethod: 'ADVANCE',
        destinationRegion: 'West India',
        deliveryLocation: 'Plot 12, Andheri East, Mumbai',
        requiredByDate: new Date('2026-09-20T00:00:00Z'),
        responseDeadline: new Date('2026-09-12T00:00:00Z'),
        expiresAt: null,
        status: 'SOURCING',
        sellerRespondedAt: null,
        items: [
          {
            quantity: 500,
            unit: 'MT',
            targetUnitPrice: 104,
            unitPriceSnapshot: 108,
            grade: {
              id: 'g1',
              code: 'HD-FILM',
              name: 'HD Film',
              displayName: 'HD Film',
            },
            product: { id: 'p1', code: 'HDPE', name: 'HDPE' },
          },
        ],
        purchaseOrders: [],
        counterOffers: [
          {
            id: 'co-1',
            createdByRole: 'CUSTOMER',
            unitPrice: 104,
            quantity: 500,
            note: 'Need better price',
            status: 'PENDING',
            createdAt: new Date('2026-09-10T10:00:00Z'),
          },
        ],
      },
      offer: null,
    });

    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain(customerOrgId);
    expect(serialized).not.toContain('ABC Packaging');
    expect(serialized).not.toContain('Andheri East');
    for (const marker of FORBIDDEN_SELLER_IDENTITY_MARKERS) {
      expect(serialized.toLowerCase()).not.toContain(marker.toLowerCase());
    }

    expect(dto.buyer.displayName).toBe('Anonymous Buyer');
    expect(dto.buyer.reference).toMatch(/^BUYER-[A-F0-9]{8}$/);
    expect(dto.buyer.reference).toBe(anonymousBuyer(customerOrgId).reference);
    expect(dto.originalPrice).toBe(108);
    expect(dto.requestedPrice).toBe(104);
    expect(dto.differencePercent).toBeCloseTo(-3.7037, 3);
    expect(dto.quantity).toBe(500);
    expect(dto.totalValue).toBe(52_000_000);
    expect(dto.timeline[0]?.actorLabel).toBe('Anonymous Buyer');
    expect(dto.timeline[0]?.actorRole).toBe('CUSTOMER');
  });

  it('uses stable opaque buyer reference (not raw customer org id)', () => {
    const orgId = '11111111-2222-3333-4444-555555555555';
    const a = anonymousBuyer(orgId);
    const b = anonymousBuyer(orgId);
    expect(a.reference).toBe(b.reference);
    expect(a.reference).not.toContain(orgId);
    const expected = `BUYER-${createHash('sha256')
      .update(orgId)
      .digest('hex')
      .slice(0, 8)
      .toUpperCase()}`;
    expect(a.reference).toBe(expected);
  });
});
