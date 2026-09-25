import {
  BLIND_BUYER_DISPLAY_NAME,
  assertBlindSellerPayload,
} from '../common/blind-buyer.js';
import { toSellerBlindProcurementItem } from './seller-procurement-workbench.mapper.js';

describe('toSellerBlindProcurementItem', () => {
  const customerOrgId = '11111111-1111-1111-1111-111111111111';

  const base = {
    id: 'pr-1',
    referenceNumber: 'PR-2026-00982',
    status: 'SOURCING',
    priority: 'HIGH',
    paymentMethod: 'ADVANCE' as string | null,
    targetPrice: 95,
    currency: 'INR',
    requiredByDate: new Date('2026-09-20T00:00:00.000Z'),
    deliveryLocation: 'Warehouse Complex, Industrial Area Phase 2, Mumbai',
    destinationRegion: 'West India',
    responseDeadline: null as Date | null,
    expiresAt: null as Date | null,
    commerciallyAcceptedAt: null as Date | null,
    customerOrgId,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-10T00:00:00.000Z'),
    items: [
      {
        id: 'item-1',
        quantity: 500,
        unit: 'MT',
        targetUnitPrice: 95,
        grade: {
          id: 'grade-1',
          code: 'HD-FILM',
          name: 'HD Film',
          displayName: 'HD Film',
        },
        product: { id: 'prod-1', code: 'HDPE', name: 'HDPE' },
      },
    ],
    priceRevisions: [],
    purchaseOrders: [],
    counterOffers: [],
  };

  it('returns Anonymous Buyer and never exposes customer identity', () => {
    const dto = toSellerBlindProcurementItem(base);
    expect(dto.buyerDisplayName).toBe(BLIND_BUYER_DISPLAY_NAME);
    expect(dto.referenceId).toBe('PR-2026-00982');
    expect(dto.productName).toBe('HDPE');
    expect(dto.gradeName).toBe('HD Film');
    expect(dto.quantity).toBe(500);
    expect(dto.currentStage).toBe('PR');
    assertBlindSellerPayload(dto);
    const json = JSON.stringify(dto);
    expect(json).not.toContain(customerOrgId);
    expect(json).not.toContain('ABC Packaging');
    expect(json).not.toMatch(/"customerId"/);
    expect(json).not.toMatch(/"companyName"/);
    expect(json).not.toMatch(/"email"/);
    expect(json).not.toMatch(/"phone"/);
    expect(json).not.toMatch(/"gstin"/i);
  });

  it('maps converted PO into later pipeline stages without customer fields', () => {
    const dto = toSellerBlindProcurementItem({
      ...base,
      status: 'CONVERTED_TO_ORDER',
      purchaseOrders: [
        {
          id: 'po-1',
          referenceNumber: 'PO-2026-001',
          status: 'CONFIRMED',
          totalAmount: 47_500_000,
          orderedQuantity: 500,
          confirmedAt: new Date('2026-09-05T00:00:00.000Z'),
          createdAt: new Date('2026-09-05T00:00:00.000Z'),
          updatedAt: new Date('2026-09-05T00:00:00.000Z'),
          payments: [
            {
              id: 'pay-1',
              status: 'PENDING',
              amount: 47_500_000,
              createdAt: new Date(),
            },
          ],
          dispatches: [],
          shipments: [],
          deliveries: [],
        },
      ],
    });
    expect(dto.buyerDisplayName).toBe('Anonymous Buyer');
    expect(dto.currentStage).toBe('PAYMENT');
    expect(dto.orderId).toBe('PO-2026-001');
    assertBlindSellerPayload(dto);
  });
});
