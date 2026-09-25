import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrSellerDispatchService } from './pr-seller-dispatch.service.js';

describe('PrSellerDispatchService', () => {
  const prisma = {
    purchaseRequest: {
      findMany: vi.fn(),
    },
  };

  const matching = {
    matchPurchaseRequest: vi.fn(),
  };

  const prEvents = {
    record: vi.fn(),
    notifyStub: vi.fn(),
  };

  let service: PrSellerDispatchService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PrSellerDispatchService(
      prisma as never,
      matching as never,
      prEvents as never,
    );
  });

  it('delegates unmatched PRs to the matching service', async () => {
    prisma.purchaseRequest.findMany
      .mockResolvedValueOnce([
        {
          id: 'pr-1',
          referenceNumber: 'PR-2026-000099',
          responseDeadline: new Date(Date.now() + 10 * 60 * 1000),
          expiresAt: null,
          items: [
            {
              id: 'item-1',
              offerId: 'offer-1',
              productId: 'product-1',
              gradeId: 'grade-1',
              quantity: 20,
            },
          ],
        },
      ])
      // repairMissingDispatchEvents
      .mockResolvedValueOnce([]);

    matching.matchPurchaseRequest.mockResolvedValueOnce({
      matchesCreated: 1,
      matches: [{ organizationId: 'seller-org-kv' }],
      primarySellerOrgId: 'seller-org-kv',
    });

    const result = await service.dispatchPending();

    expect(result.assigned).toBe(1);
    expect(matching.matchPurchaseRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseRequestId: 'pr-1',
        explicitOfferId: 'offer-1',
        productId: 'product-1',
        gradeId: 'grade-1',
        quantity: 20,
        multiSeller: false,
      }),
    );
  });

  it('fans out when PR has no explicit offer', async () => {
    prisma.purchaseRequest.findMany
      .mockResolvedValueOnce([
        {
          id: 'pr-2',
          referenceNumber: 'PR-2026-000100',
          responseDeadline: new Date(Date.now() + 10 * 60 * 1000),
          expiresAt: null,
          items: [
            {
              id: 'item-2',
              offerId: null,
              productId: 'product-1',
              gradeId: 'grade-1',
              quantity: 12,
            },
          ],
        },
      ])
      .mockResolvedValueOnce([]);

    matching.matchPurchaseRequest.mockResolvedValueOnce({
      matchesCreated: 2,
      matches: [
        { organizationId: 'org-a' },
        { organizationId: 'org-b' },
      ],
      primarySellerOrgId: 'org-a',
    });

    const result = await service.dispatchPending();

    expect(result.assigned).toBe(1);
    expect(matching.matchPurchaseRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseRequestId: 'pr-2',
        multiSeller: true,
      }),
    );
  });
});
