import { Prisma } from '../../../generated/prisma/client.js';
import { describe, expect, it } from 'vitest';
import { SellerMatchingService } from './seller-matching.service.js';

describe('seller matching rank', () => {
  it('picks the lowest unit price that can fulfil quantity', () => {
    const service = Object.create(SellerMatchingService.prototype) as SellerMatchingService;
    const cheap = {
      id: 'cheap',
      organizationId: 'seller-a',
      quantity: new Prisma.Decimal(80),
      moq: new Prisma.Decimal(10),
      basePrice: new Prisma.Decimal(99000),
      unit: 'MT',
      status: 'ACTIVE',
      validFrom: null,
      validUntil: null,
      deletedAt: null,
      visibility: 'MARKETPLACE',
      product: { status: 'ACTIVE', deletedAt: null },
      priceTiers: [],
    } as never;
    const expensive = {
      id: 'expensive',
      organizationId: 'seller-b',
      quantity: new Prisma.Decimal(200),
      moq: new Prisma.Decimal(10),
      basePrice: new Prisma.Decimal(110000),
      unit: 'MT',
      status: 'ACTIVE',
      validFrom: null,
      validUntil: null,
      deletedAt: null,
      visibility: 'MARKETPLACE',
      product: { status: 'ACTIVE', deletedAt: null },
      priceTiers: [],
    } as never;

    const winner = service.pickBest([expensive, cheap], 25, '1');
    expect(winner?.offer.id).toBe('cheap');
  });

  it('skips offers that cannot fulfil inventory', () => {
    const service = Object.create(SellerMatchingService.prototype) as SellerMatchingService;
    const short = {
      id: 'short',
      organizationId: 'seller-a',
      quantity: new Prisma.Decimal(10),
      moq: new Prisma.Decimal(5),
      basePrice: new Prisma.Decimal(1),
      unit: 'MT',
      status: 'ACTIVE',
      validFrom: null,
      validUntil: null,
      deletedAt: null,
      visibility: 'MARKETPLACE',
      product: { status: 'ACTIVE', deletedAt: null },
      priceTiers: [],
    } as never;
    const enough = {
      id: 'enough',
      organizationId: 'seller-b',
      quantity: new Prisma.Decimal(100),
      moq: new Prisma.Decimal(5),
      basePrice: new Prisma.Decimal(2),
      unit: 'MT',
      status: 'ACTIVE',
      validFrom: null,
      validUntil: null,
      deletedAt: null,
      visibility: 'MARKETPLACE',
      product: { status: 'ACTIVE', deletedAt: null },
      priceTiers: [],
    } as never;
    const winner = service.pickBest([short, enough], 25, '1');
    expect(winner?.offer.id).toBe('enough');
  });
});
