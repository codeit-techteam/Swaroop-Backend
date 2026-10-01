import {
  CustomerStatus,
  ImportSide,
  ImportTradeParty,
  SellerStatus,
} from '../../../generated/prisma/client.js';
import type { PrismaService } from '../../../database/prisma.service.js';
import {
  ImportActorService,
  type ImportActor,
} from './import-actor.service.js';

describe('ImportActorService.actorRole', () => {
  const service = new ImportActorService({} as PrismaService);
  const buyer = {
    customerProfileId: 'cp',
    organizationId: 'org-b',
    status: CustomerStatus.ACTIVE,
  };
  const seller = {
    sellerProfileId: 'sp',
    organizationId: 'org-s',
    status: SellerStatus.APPROVED,
    kind: 'OWNER' as const,
  };
  const dual: ImportActor = { userId: 'u', roles: ['CUSTOMER'], buyer, seller };

  it('records a dual-profile user by the side they act for', () => {
    expect(service.actorRole(dual, ImportSide.BUY)).toBe('CUSTOMER');
    expect(service.actorRole(dual, ImportTradeParty.BUYER)).toBe('CUSTOMER');
    expect(service.actorRole(dual, ImportSide.SELL)).toBe('SELLER');
    expect(service.actorRole(dual, ImportTradeParty.SELLER)).toBe('SELLER');
  });

  it('distinguishes seller managers', () => {
    const manager: ImportActor = {
      ...dual,
      buyer: null,
      seller: { ...seller, kind: 'MANAGER' },
    };
    expect(service.actorRole(manager, ImportSide.SELL)).toBe('SELLER_MANAGER');
  });
});
