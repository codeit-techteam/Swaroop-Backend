import { describe, expect, it, vi } from 'vitest';
import {
  ImportDealStatus,
  ImportShipmentStatus as S,
  ImportTradeParty,
  Prisma,
} from '../../../generated/prisma/client.js';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { ImportActorService } from '../common/import-actor.service.js';
import {
  assertShipmentTransition,
  fulfilmentStatus,
  shipmentTransitions,
} from '../domain/import-shipment.machine.js';
import { ImportException } from '../domain/import.errors.js';
import { ImportShipmentsService } from './import-shipments.service.js';

const D = (v: number | string) => new Prisma.Decimal(v);

describe('import shipment status machine', () => {
  it('follows the booked → delivered lifecycle', () => {
    const path = [
      S.BOOKED,
      S.SHIPPED,
      S.IN_TRANSIT,
      S.ARRIVED,
      S.CUSTOMS_CLEARANCE,
      S.OUT_FOR_DELIVERY,
      S.DELIVERED,
    ];
    for (let i = 1; i < path.length; i += 1) {
      expect(() =>
        assertShipmentTransition(path[i - 1], path[i]),
      ).not.toThrow();
    }
  });

  it('rejects skipping departure, reviving delivered and cancelling in transit', () => {
    expect(() => assertShipmentTransition(S.BOOKED, S.DELIVERED)).toThrow(
      ImportException,
    );
    expect(shipmentTransitions(S.DELIVERED)).toEqual([]);
    expect(() => assertShipmentTransition(S.IN_TRANSIT, S.CANCELLED)).toThrow(
      ImportException,
    );
  });

  it('lets an exception recover or be cancelled', () => {
    expect(shipmentTransitions(S.EXCEPTION)).toEqual(
      expect.arrayContaining([S.IN_TRANSIT, S.DELIVERED, S.CANCELLED]),
    );
  });
});

describe('deal fulfilment from delivered quantity', () => {
  it('moves to partially fulfilled, then fulfilled', () => {
    expect(fulfilmentStatus(ImportDealStatus.CONFIRMED, D(300), D(100))).toBe(
      ImportDealStatus.PARTIALLY_FULFILLED,
    );
    expect(
      fulfilmentStatus(ImportDealStatus.PARTIALLY_FULFILLED, D(300), D(300)),
    ).toBe(ImportDealStatus.FULFILLED);
  });

  it('keeps the status when nothing changes or the deal is not shippable', () => {
    expect(fulfilmentStatus(ImportDealStatus.CONFIRMED, D(300), D(0))).toBe(
      null,
    );
    expect(
      fulfilmentStatus(ImportDealStatus.PARTIALLY_FULFILLED, D(300), D(150)),
    ).toBe(null);
    expect(
      fulfilmentStatus(ImportDealStatus.PENDING_CONFIRMATION, D(300), D(300)),
    ).toBe(null);
    expect(fulfilmentStatus(ImportDealStatus.CANCELLED, D(300), D(300))).toBe(
      null,
    );
  });
});

describe('import shipment authorisation', () => {
  const BUYER_ORG = '00000000-0000-0000-0000-0000000000b1';
  const SELLER_ORG = '00000000-0000-0000-0000-0000000000a1';
  const deal = {
    id: '00000000-0000-0000-0000-00000000d001',
    referenceNumber: 'IDL-202610-000001',
    buyerOrgId: BUYER_ORG,
    sellerOrgId: SELLER_ORG,
    status: ImportDealStatus.CONFIRMED,
    sellListing: null,
    buyListing: null,
  };

  function setup(actor: Partial<{ buyerOrg: string; sellerOrg: string }>) {
    const prisma = {
      importDeal: { findUnique: vi.fn().mockResolvedValue(deal) },
      importShipment: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(),
    };
    const actors = new ImportActorService(prisma as never);
    vi.spyOn(actors, 'resolve').mockResolvedValue({
      userId: 'u1',
      roles: [actor.buyerOrg ? RoleCode.CUSTOMER : RoleCode.SELLER],
      buyer: actor.buyerOrg
        ? {
            customerProfileId: 'c1',
            organizationId: actor.buyerOrg,
            status: 'ACTIVE' as never,
          }
        : null,
      seller: actor.sellerOrg
        ? {
            sellerProfileId: 's1',
            organizationId: actor.sellerOrg,
            status: 'APPROVED' as never,
            kind: 'OWNER',
          }
        : null,
    });
    const idempotency = {
      normalise: vi.fn().mockReturnValue(null),
      replay: vi.fn().mockResolvedValue(null),
    };
    const service = new ImportShipmentsService(
      prisma as never,
      actors,
      {} as never,
      idempotency as never,
      { log: vi.fn() } as never,
      { notify: vi.fn() } as never,
    );
    return { service, prisma };
  }

  const user = { id: 'u1', roles: [] } as never;

  it('forbids the buyer from booking a shipment', async () => {
    const { service, prisma } = setup({ buyerOrg: BUYER_ORG });
    await expect(
      service.create(user, deal.id, { quantity: '100' }),
    ).rejects.toMatchObject({ code: 'IMPORT_UNAUTHORIZED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('hides deals from organisations that are not a party', async () => {
    const { service } = setup({
      sellerOrg: '00000000-0000-0000-0000-0000000000ff',
    });
    await expect(
      service.create(user, deal.id, { quantity: '100' }),
    ).rejects.toMatchObject({ code: 'DEAL_NOT_FOUND' });
  });

  it('returns 404 for shipments of other organisations', async () => {
    const { service } = setup({ buyerOrg: BUYER_ORG });
    await expect(service.get(user, deal.id)).rejects.toMatchObject({
      code: 'SHIPMENT_NOT_FOUND',
    });
  });

  it('identifies the seller party for a deal', () => {
    const actors = new ImportActorService({} as never);
    expect(
      actors.partyFor(
        {
          userId: 'u',
          roles: [],
          buyer: null,
          seller: {
            sellerProfileId: 's',
            organizationId: SELLER_ORG,
            status: 'APPROVED' as never,
            kind: 'MANAGER',
          },
        },
        deal,
      ),
    ).toBe(ImportTradeParty.SELLER);
  });
});
