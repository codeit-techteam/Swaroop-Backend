import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfferStatus, SellerStatus } from '../../../generated/prisma/client.js';
import { OffersService } from './offers.service.js';

const OFFER_ID = 'e6c39658-8a4b-45d4-bd28-693625e37b21';
const OFFER_REF = 'OFFER-CAT-PC-CL-210';
const ORG_ID = 'ceebab39-4a58-4e6b-a0af-ae78d8ceeb1f';

function buildOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: OFFER_ID,
    referenceNumber: OFFER_REF,
    organizationId: ORG_ID,
    status: OfferStatus.ACTIVE,
    version: 1,
    validFrom: null,
    validUntil: null,
    deletedAt: null,
    basePrice: 186500,
    quantity: 120,
    moq: 8,
    productId: '0bcf6012-3e80-4aee-82e6-e3b1c7a89914',
    gradeId: '65839234-4f67-43f2-b8f8-005abeec4307',
    inventoryId: null,
    warehouseId: '4688e350-dae4-4f49-88b9-b0e81a989061',
    currency: 'INR',
    product: { id: 'p1', code: 'PC-CL-210', name: 'Polycarbonate Clear Grade', gradeId: 'g1' },
    grade: { id: 'g1', code: 'PC', name: 'PC', displayName: 'PC' },
    priceTiers: [],
    warehouse: {
      id: 'w1',
      code: 'WH',
      name: 'Mundra Hub',
      city: 'Mundra',
      state: 'Gujarat',
    },
    inventory: null,
    _count: { purchaseRequestItems: 0 },
    ...overrides,
  };
}

describe('OffersService lifecycle (pause / resume / delete)', () => {
  const userId = 'seller-user-1';
  let prisma: {
    offer: {
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let sellerContext: { requireSeller: ReturnType<typeof vi.fn> };
  let audit: { log: ReturnType<typeof vi.fn> };
  let service: OffersService;

  beforeEach(() => {
    prisma = {
      offer: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (tx: typeof prisma) => unknown) =>
        fn(prisma),
      ),
    };
    sellerContext = {
      requireSeller: vi.fn().mockResolvedValue({
        organizationId: ORG_ID,
        sellerProfileId: 'seller-profile-1',
        status: SellerStatus.APPROVED,
      }),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    service = new OffersService(
      prisma as never,
      sellerContext as never,
      audit as never,
    );
  });

  it('pauses an ACTIVE offer by UUID', async () => {
    const active = buildOffer();
    const paused = buildOffer({ status: OfferStatus.PAUSED, version: 2 });
    prisma.offer.findFirst.mockResolvedValue(active);
    prisma.offer.update.mockResolvedValue(paused);

    const result = await service.pause(userId, OFFER_ID);

    expect(result.status).toBe(OfferStatus.PAUSED);
    expect(prisma.offer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: OFFER_ID, organizationId: ORG_ID }),
      }),
    );
    expect(prisma.offer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: OFFER_ID },
        data: expect.objectContaining({ status: OfferStatus.PAUSED }),
      }),
    );
  });

  it('pauses an ACTIVE offer by reference number', async () => {
    const active = buildOffer();
    const paused = buildOffer({ status: OfferStatus.PAUSED, version: 2 });
    prisma.offer.findFirst.mockResolvedValue(active);
    prisma.offer.update.mockResolvedValue(paused);

    const result = await service.pause(userId, OFFER_REF);

    expect(result.status).toBe(OfferStatus.PAUSED);
    expect(prisma.offer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          referenceNumber: OFFER_REF,
          organizationId: ORG_ID,
        }),
      }),
    );
    expect(prisma.offer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: OFFER_ID } }),
    );
  });

  it('is idempotent when pausing an already paused offer', async () => {
    prisma.offer.findFirst.mockResolvedValue(
      buildOffer({ status: OfferStatus.PAUSED }),
    );

    const result = await service.pause(userId, OFFER_ID);

    expect(result.status).toBe(OfferStatus.PAUSED);
    expect(prisma.offer.update).not.toHaveBeenCalled();
  });

  it('rejects pause for unsupported statuses', async () => {
    prisma.offer.findFirst.mockResolvedValue(
      buildOffer({ status: OfferStatus.DRAFT }),
    );

    await expect(service.pause(userId, OFFER_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('resumes a paused offer', async () => {
    const paused = buildOffer({ status: OfferStatus.PAUSED });
    const active = buildOffer({ status: OfferStatus.ACTIVE, version: 2 });
    prisma.offer.findFirst.mockResolvedValue(paused);
    prisma.offer.update.mockResolvedValue(active);

    const result = await service.resume(userId, OFFER_REF);

    expect(result.status).toBe(OfferStatus.ACTIVE);
    expect(prisma.offer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: OFFER_ID },
        data: expect.objectContaining({ status: OfferStatus.ACTIVE }),
      }),
    );
  });

  it('rejects resume when offer is expired by validity window', async () => {
    prisma.offer.findFirst.mockResolvedValue(
      buildOffer({
        status: OfferStatus.PAUSED,
        validUntil: new Date('2020-01-01T00:00:00.000Z'),
      }),
    );

    await expect(service.resume(userId, OFFER_ID)).rejects.toThrow(/expired/i);
  });

  it('soft-deletes an eligible offer', async () => {
    const active = buildOffer();
    const closed = buildOffer({
      status: OfferStatus.CLOSED,
      deletedAt: new Date(),
      version: 2,
    });
    prisma.offer.findFirst.mockResolvedValue(active);
    prisma.offer.update.mockResolvedValue(closed);

    const result = await service.softDelete(userId, OFFER_REF);

    expect(result.status).toBe(OfferStatus.CLOSED);
    expect(prisma.offer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: OFFER_ID },
        data: expect.objectContaining({
          status: OfferStatus.CLOSED,
          deletedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('rejects delete for expired offers without destroying history', async () => {
    prisma.offer.findFirst.mockResolvedValue(
      buildOffer({ status: OfferStatus.EXPIRED }),
    );

    await expect(service.softDelete(userId, OFFER_ID)).rejects.toThrow(
      /Expired offers cannot be deleted/i,
    );
    expect(prisma.offer.update).not.toHaveBeenCalled();
  });

  it('returns 404 when offer is missing or belongs to another seller', async () => {
    prisma.offer.findFirst.mockResolvedValue(null);

    await expect(service.pause(userId, OFFER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects unauthenticated seller context failures', async () => {
    sellerContext.requireSeller.mockRejectedValue(
      new NotFoundException('Seller profile not found'),
    );

    await expect(service.pause(userId, OFFER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
