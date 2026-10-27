import { describe, expect, it, vi } from 'vitest';
import {
  ImportListingStatus,
  ImportSide,
  type Prisma,
} from '../../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  ImportActorService,
  type ImportActor,
} from '../common/import-actor.service.js';
import { OPEN_LISTING_STATUSES } from '../domain/import.constants.js';
import { ImportListingsService } from './import-listings.service.js';

/**
 * I-01: a buyer opening the Import "Sell offers" market must see every other
 * organisation's published USD/EUR SELL listing, and never its own, never
 * drafts, and never offers without an explicit currency.
 *
 * This pins the exact Prisma `where` the service sends for
 * `GET /v1/import/sell?scope=market` so the market query cannot silently
 * regress (the production symptom was an empty buyer list).
 */
const BUYER_ORG = 'org-buyer-1';
const SELLER_ORG = 'org-seller-1';

const buyerActor: ImportActor = {
  userId: 'user-buyer',
  roles: ['CUSTOMER'],
  buyer: {
    customerProfileId: 'cp-1',
    organizationId: BUYER_ORG,
    status: 'APPROVED',
  } as ImportActor['buyer'],
  seller: null,
};

const sellerActor: ImportActor = {
  userId: 'user-seller',
  roles: ['SELLER'],
  buyer: null,
  seller: {
    sellerProfileId: 'sp-1',
    organizationId: SELLER_ORG,
    status: 'APPROVED',
    kind: 'OWNER',
  } as ImportActor['seller'],
};

const user = { id: 'user-x' } as unknown as AuthenticatedUser;

function makeService(actor: ImportActor) {
  const findMany = vi.fn().mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(0);
  const prisma = { importListing: { findMany, count } };
  const actors = Object.create(
    ImportActorService.prototype,
  ) as ImportActorService;
  actors.resolve = vi.fn().mockResolvedValue(actor);
  const settings = { get: vi.fn().mockResolvedValue({ allowCustomGrade: true }) };

  const service = Object.create(
    ImportListingsService.prototype,
  ) as ImportListingsService & {
    prisma: typeof prisma;
    actors: ImportActorService;
    settings: typeof settings;
  };
  service.prisma = prisma;
  service.actors = actors;
  service.settings = settings;
  return { service, findMany, count };
}

const andClauses = (findMany: ReturnType<typeof vi.fn>) => {
  const where = findMany.mock.calls[0][0].where as Prisma.ImportListingWhereInput;
  return where.AND as Prisma.ImportListingWhereInput[];
};

describe('ImportListingsService.list — market scope (I-01)', () => {
  it('buyer on the SELL side defaults to the market scope and excludes own org / drafts / currency-less rows', async () => {
    const { service, findMany } = makeService(buyerActor);
    const result = await service.list(user, ImportSide.SELL, {} as never);

    expect(result.meta.scope).toBe('market');
    const and = andClauses(findMany);

    expect(and).toContainEqual({ side: ImportSide.SELL, deletedAt: null });
    expect(and).toContainEqual({ ownerOrgId: { not: BUYER_ORG } });
    expect(and).toContainEqual({ status: { in: OPEN_LISTING_STATUSES } });
    expect(and).toContainEqual({
      OR: [{ currencyCode: { not: null } }, { currencyId: { not: null } }],
    });
    // Must never pin to the viewer's own org in market mode.
    expect(and).not.toContainEqual({ ownerOrgId: BUYER_ORG });
    expect(OPEN_LISTING_STATUSES).not.toContain(ImportListingStatus.DRAFT);
  });

  it('seller on the SELL side defaults to "mine" and is pinned to its own org', async () => {
    const { service, findMany } = makeService(sellerActor);
    const result = await service.list(user, ImportSide.SELL, {} as never);

    expect(result.meta.scope).toBe('mine');
    const and = andClauses(findMany);
    expect(and).toContainEqual({ ownerOrgId: SELLER_ORG });
    expect(and).not.toContainEqual({ ownerOrgId: { not: SELLER_ORG } });
  });

  it('market scope never widens to non-open statuses even when requested', async () => {
    const { service, findMany } = makeService(buyerActor);
    await service.list(user, ImportSide.SELL, {
      scope: 'market',
      status: [ImportListingStatus.DRAFT, ImportListingStatus.PUBLISHED],
    } as never);

    const and = andClauses(findMany);
    expect(and).toContainEqual({
      status: { in: [ImportListingStatus.PUBLISHED] },
    });
  });

  it('currency filter matches the snapshot code or the currency master', async () => {
    const { service, findMany } = makeService(buyerActor);
    await service.list(user, ImportSide.SELL, {
      scope: 'market',
      currencyCode: 'usd',
    } as never);

    const and = andClauses(findMany);
    expect(and).toContainEqual({
      OR: [{ currencyCode: 'USD' }, { currency: { code: 'USD' } }],
    });
  });
});
