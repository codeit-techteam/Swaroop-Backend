import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PurchaseRequestStatus } from '../../../generated/prisma/client.js';
import { PrSourcingLifecycleService } from './pr-sourcing-lifecycle.service.js';

describe('PrSourcingLifecycleService', () => {
  const prisma = {
    purchaseRequest: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    purchaseRequestSellerMatch: {
      updateMany: vi.fn(),
    },
    purchaseRequestEvent: {
      findFirst: vi.fn(),
    },
    counterOffer: {
      updateMany: vi.fn(),
    },
  };

  const prEvents = {
    record: vi.fn(),
    notifyStub: vi.fn(),
  };

  let service: PrSourcingLifecycleService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PrSourcingLifecycleService(prisma as never, prEvents as never);
  });

  it('expires past-deadline sourcing PRs and records events', async () => {
    prisma.purchaseRequest.findMany.mockResolvedValueOnce([
      {
        id: 'pr-1',
        referenceNumber: 'PR-2026-000001',
        customerOrgId: 'cust-org',
        sellerOrgId: 'seller-org',
        createdById: 'user-1',
      },
    ]);
    prisma.purchaseRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.purchaseRequestSellerMatch.updateMany.mockResolvedValueOnce({
      count: 1,
    });
    prEvents.record.mockResolvedValue({});
    prEvents.notifyStub.mockResolvedValue(undefined);

    // counter offers + warnings empty for this assert path
    prisma.counterOffer.updateMany.mockResolvedValue({ count: 0 });
    prisma.purchaseRequest.findMany.mockResolvedValueOnce([]);

    const expired = await service.expireDuePurchaseRequests();
    expect(expired).toBe(1);
    expect(prisma.purchaseRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'pr-1' }),
        data: { status: PurchaseRequestStatus.EXPIRED },
      }),
    );
    expect(prEvents.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        purchaseRequestId: 'pr-1',
        eventType: 'PURCHASE_REQUEST_EXPIRED',
      }),
    );
  });

  it('markDispatchedToSeller is idempotent when SENT_TO_SELLER exists', async () => {
    prisma.purchaseRequestEvent.findFirst.mockResolvedValueOnce({ id: 'evt-1' });
    await service.markDispatchedToSeller({
      purchaseRequestId: 'pr-1',
      sellerOrgId: 'seller-org',
      responseDeadline: new Date(),
    });
    expect(prEvents.record).not.toHaveBeenCalled();
  });
});
