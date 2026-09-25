import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OfferStatus,
  OrganizationStatus,
  ProductStatus,
  PurchaseRequestSellerMatchStatus,
  SellerStatus,
  VerificationStatus,
} from '../../../generated/prisma/client.js';
import { PurchaseRequestMatchingService } from './purchase-request-matching.service.js';

describe('PurchaseRequestMatchingService', () => {
  const prisma = {
    offer: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    inventory: {
      findMany: vi.fn(),
    },
    purchaseRequest: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    purchaseRequestItem: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    purchaseRequestSellerMatch: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    purchaseRequestEvent: {
      findFirst: vi.fn(),
    },
  };

  const prEvents = {
    record: vi.fn(),
    notifyStub: vi.fn(),
  };

  let service: PurchaseRequestMatchingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PurchaseRequestMatchingService(
      prisma as never,
      prEvents as never,
    );
  });

  it('matches only eligible active sellers with sufficient inventory', async () => {
    prisma.offer.findMany.mockResolvedValueOnce([
      {
        id: 'offer-a',
        organizationId: 'org-a',
        productId: 'product-1',
        gradeId: 'grade-1',
        quantity: 100,
        moq: 10,
        basePrice: 90,
        warehouseId: null,
        priceTiers: [],
        inventory: {
          id: 'inv-a',
          availableQty: 80,
          reservedQty: 0,
          status: 'AVAILABLE',
          deletedAt: null,
        },
      },
      {
        id: 'offer-b',
        organizationId: 'org-b',
        productId: 'product-1',
        gradeId: 'grade-1',
        quantity: 100,
        moq: 10,
        basePrice: 95,
        warehouseId: null,
        priceTiers: [],
        inventory: {
          id: 'inv-b',
          availableQty: 5,
          reservedQty: 0,
          status: 'AVAILABLE',
          deletedAt: null,
        },
      },
    ]);

    const matches = await service.findEligibleSellers({
      productId: 'product-1',
      quantity: 15,
      multiSeller: true,
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.organizationId).toBe('org-a');
    expect(prisma.offer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: OfferStatus.ACTIVE,
          product: expect.objectContaining({
            status: ProductStatus.ACTIVE,
          }),
          organization: expect.objectContaining({
            status: OrganizationStatus.ACTIVE,
            verificationStatus: VerificationStatus.APPROVED,
            sellerProfile: expect.objectContaining({
              status: SellerStatus.APPROVED,
            }),
          }),
        }),
      }),
    );
  });

  it('creates seller match rows and notifies each seller', async () => {
    prisma.offer.findFirst.mockResolvedValueOnce({
      id: 'offer-a',
      organizationId: 'org-a',
      productId: 'product-1',
      gradeId: 'grade-1',
      quantity: 100,
      moq: 10,
      basePrice: 90,
      warehouseId: null,
      priceTiers: [],
      inventory: {
        id: 'inv-a',
        availableQty: 80,
        reservedQty: 0,
        status: 'AVAILABLE',
        deletedAt: null,
      },
    });
    prisma.purchaseRequest.findFirst.mockResolvedValueOnce({
      id: 'pr-1',
      referenceNumber: 'PR-2026-000001',
      sellerOrgId: null,
      responseDeadline: new Date(Date.now() + 15 * 60 * 1000),
      expiresAt: null,
      createdAt: new Date(),
    });
    prisma.purchaseRequestSellerMatch.findUnique.mockResolvedValueOnce(null);
    prisma.purchaseRequestSellerMatch.create.mockResolvedValueOnce({
      id: 'match-1',
      status: PurchaseRequestSellerMatchStatus.MATCHED,
    });
    prisma.purchaseRequest.update.mockResolvedValueOnce({});
    prisma.purchaseRequestItem.findFirst.mockResolvedValueOnce({
      id: 'item-1',
      offerId: null,
    });
    prisma.purchaseRequestItem.update.mockResolvedValueOnce({});
    prisma.purchaseRequestEvent.findFirst.mockResolvedValueOnce(null);
    prEvents.record.mockResolvedValue({});
    prEvents.notifyStub.mockResolvedValue(undefined);

    const result = await service.matchPurchaseRequest({
      purchaseRequestId: 'pr-1',
      explicitOfferId: 'offer-a',
      quantity: 15,
      multiSeller: false,
    });

    expect(result.matchesCreated).toBe(1);
    expect(result.primarySellerOrgId).toBe('org-a');
    expect(prisma.purchaseRequestSellerMatch.create).toHaveBeenCalled();
    expect(prEvents.notifyStub).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-a',
        eventType: 'SENT_TO_SELLER',
      }),
    );
  });

  it('removes competing matches when one seller accepts', async () => {
    const tx = {
      purchaseRequestSellerMatch: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await service.markSellerAccepted(tx as never, {
      purchaseRequestId: 'pr-1',
      sellerOrgId: 'org-a',
    });

    expect(tx.purchaseRequestSellerMatch.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.purchaseRequestSellerMatch.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ sellerOrgId: 'org-a' }),
        data: expect.objectContaining({
          status: PurchaseRequestSellerMatchStatus.ACCEPTED,
        }),
      }),
    );
    expect(tx.purchaseRequestSellerMatch.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          sellerOrgId: { not: 'org-a' },
        }),
        data: expect.objectContaining({
          status: PurchaseRequestSellerMatchStatus.REMOVED,
        }),
      }),
    );
  });
});
