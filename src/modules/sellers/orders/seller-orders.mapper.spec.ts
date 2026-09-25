import { describe, expect, it } from 'vitest';
import {
  assertBlindSellerOrderPayload,
  buildSellerOrderTimeline,
  toSellerDisplayStatus,
  toSellerOrderDetailDto,
  toSellerOrderListDto,
} from './seller-orders.mapper.js';
import type { SellerPurchaseOrderSource } from './seller-orders.mapper.js';

function samplePo(
  overrides: Partial<SellerPurchaseOrderSource> = {},
): SellerPurchaseOrderSource {
  return {
    id: 'po-1',
    referenceNumber: 'PO-2026-829300',
    purchaseRequestId: 'pr-1',
    customerOrgId: 'customer-org-secret-uuid',
    status: 'CONFIRMED',
    currency: 'INR',
    subtotal: 1920,
    taxAmount: 0,
    totalAmount: 1920,
    paymentMethod: 'ADVANCE',
    orderedQuantity: 20,
    dispatchedQuantity: 0,
    deliveredQuantity: 0,
    confirmedAt: new Date('2026-09-24T10:00:00Z'),
    createdAt: new Date('2026-09-24T10:00:00Z'),
    updatedAt: new Date('2026-09-24T10:00:00Z'),
    metadata: {
      commercialSnapshot: {
        quantity: 20,
        unit: 'MT',
        unitPrice: 96,
        totalValue: 1920,
      },
    },
    purchaseRequest: {
      id: 'pr-1',
      referenceNumber: 'PR-2026-0001',
      status: 'CONVERTED_TO_ORDER',
      destinationRegion: 'West India',
      deliveryLocation: 'Plot 12, Andheri East, Mumbai',
      items: [
        {
          quantity: 20,
          unit: 'MT',
          unitPriceSnapshot: 96,
          grade: {
            id: 'g1',
            code: 'HDPE-FILM',
            name: 'HDPE Film',
            displayName: 'HDPE Film',
          },
          product: {
            id: 'p1',
            code: 'P-001',
            name: 'HDPE Film Grade',
          },
        },
      ],
      events: [
        {
          id: 'e1',
          eventType: 'SELLER_ACCEPTED',
          createdAt: new Date('2026-09-24T09:50:00Z'),
          metadata: { customerEmail: 'buyer@secret.com' },
        },
      ],
    },
    payments: [],
    proformaInvoices: [],
    dispatches: [],
    shipments: [],
    deliveries: [],
    ...overrides,
  };
}

describe('seller orders blind mapper', () => {
  it('never exposes customer identity on list DTO', () => {
    const dto = toSellerOrderListDto(samplePo());
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain('customer-org-secret-uuid');
    expect(serialized).not.toContain('Andheri East');
    expect(serialized).not.toContain('customerOrgId');
    expect(dto.buyer.displayName).toBe('Anonymous Buyer');
    expect(dto.buyer.reference).toMatch(/^BUYER-[A-F0-9]{8}$/);
    expect(dto.deliveryRegion).toBe('West India');
    expect(dto.poNumber).toBe('PO-2026-829300');
    expect(dto.orderValue).toBe('1920.00');
    expect(dto.expectedDispatchLabel).toBe('Not scheduled');
    expect(assertBlindSellerOrderPayload(dto)).toEqual([]);
  });

  it('never exposes customer identity on detail DTO', () => {
    const dto = toSellerOrderDetailDto(samplePo());
    expect(assertBlindSellerOrderPayload(dto)).toEqual([]);
    expect(JSON.stringify(dto)).not.toContain('buyer@secret.com');
  });

  it('strips event metadata from timeline', () => {
    const timeline = buildSellerOrderTimeline(samplePo());
    const serialized = JSON.stringify(timeline);
    expect(serialized).not.toContain('buyer@secret.com');
    expect(serialized).not.toContain('customerEmail');
    expect(timeline.events.some((e) => e.type === 'SELLER_ACCEPTED')).toBe(
      true,
    );
  });

  it('maps PO statuses to seller display groups', () => {
    expect(toSellerDisplayStatus(samplePo({ status: 'CONFIRMED' }))).toBe(
      'CONFIRMED',
    );
    expect(
      toSellerDisplayStatus(
        samplePo({
          status: 'CONFIRMED',
          proformaInvoices: [
            {
              id: 'pi1',
              piNumber: 'PI-1',
              status: 'ISSUED',
              totalAmount: 1920,
              createdAt: new Date(),
            },
          ],
          payments: [
            {
              id: 'pay1',
              referenceNumber: 'PAY-1',
              status: 'PENDING',
              amount: 1920,
              verifiedAt: null,
              createdAt: new Date(),
            },
          ],
        }),
      ),
    ).toBe('PROCESSING');
    expect(
      toSellerDisplayStatus(samplePo({ status: 'READY_FOR_DISPATCH' })),
    ).toBe('READY_FOR_DISPATCH');
    expect(toSellerDisplayStatus(samplePo({ status: 'IN_TRANSIT' }))).toBe(
      'DISPATCHED',
    );
    expect(toSellerDisplayStatus(samplePo({ status: 'DELIVERED' }))).toBe(
      'DELIVERED',
    );
    expect(toSellerDisplayStatus(samplePo({ status: 'CANCELLED' }))).toBe(
      'CANCELLED',
    );
  });
});
