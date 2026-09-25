import { describe, expect, it } from 'vitest';
import { toBlindPurchaseRequest } from '../../sellers/common/blind-pr.mapper.js';

describe('blind marketplace seller PR DTO', () => {
  it('never exposes customer identity fields', () => {
    const dto = toBlindPurchaseRequest({
      id: 'pr-1',
      referenceNumber: 'PR-2026-000123',
      status: 'SOURCING',
      priority: 'NORMAL',
      paymentMethod: 'ADVANCE',
      targetPrice: 96000,
      currency: 'INR',
      requiredByDate: null,
      deliveryLocation: 'Plot 12, Andheri East, Mumbai',
      destinationRegion: 'West India',
      notes: 'Urgent',
      expiresAt: null,
      responseDeadline: new Date('2026-09-24T16:15:00Z'),
      submittedAt: new Date('2026-09-24T16:00:00Z'),
      createdAt: new Date('2026-09-24T16:00:00Z'),
      viewedBySellerAt: null,
      customerOrgId: 'customer-org-secret-uuid',
      items: [
        {
          id: 'item-1',
          quantity: 15,
          unit: 'MT',
          packaging: 'Bag',
          notes: null,
          targetUnitPrice: 96,
          grade: {
            id: 'g1',
            code: 'HDPE-FILM',
            name: 'HDPE Film',
            displayName: 'Demo HDPE Film',
          },
          product: {
            id: 'p1',
            code: 'P-001',
            name: 'Demo HDPE Film',
          },
        },
      ],
    });

    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain('customer-org-secret-uuid');
    expect(serialized).not.toContain('customerOrgId');
    expect(serialized).not.toContain('customerId');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('phone');
    expect(serialized).not.toContain('gstin');
    expect(dto.buyer.displayName).toBe('Anonymous Buyer');
    expect(dto.buyer.reference).toMatch(/^BUYER-[A-F0-9]{8}$/);
    expect(dto.destinationRegion).toBe('West India');
    // Full address must not leak — region/masked only.
    expect(serialized).not.toContain('Andheri East');
  });
});
