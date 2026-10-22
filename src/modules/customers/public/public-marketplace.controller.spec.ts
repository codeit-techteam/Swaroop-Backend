import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { JwtAuthGuard } from '../../auth/index.js';
import { buyableMarketplaceProductWhere } from '../marketplace/marketplace.service.js';
import { PublicMarketplaceController } from './public-marketplace.controller.js';

describe('PublicMarketplaceController guest authorization', () => {
  it('exposes guest routes without JwtAuthGuard (class-level)', () => {
    const guards =
      (Reflect.getMetadata(
        GUARDS_METADATA,
        PublicMarketplaceController,
      ) as unknown[]) ?? [];
    expect(guards).not.toContain(JwtAuthGuard);
    expect(guards).toHaveLength(0);
  });

  it('pricing estimate handler is also unguarded', () => {
    const handler = PublicMarketplaceController.prototype.estimate;
    const guards =
      (Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? [];
    expect(guards).not.toContain(JwtAuthGuard);
    expect(guards).toHaveLength(0);
  });

  it('buyable product filter requires ACTIVE product + live marketplace offer', () => {
    const where = buyableMarketplaceProductWhere(
      new Date('2026-10-22T00:00:00.000Z'),
    );
    expect(where).toMatchObject({
      deletedAt: null,
      status: 'ACTIVE',
      grade: {
        deletedAt: null,
        status: 'ACTIVE',
        customerVisible: true,
      },
    });
    expect(where.offers).toEqual({
      some: expect.objectContaining({
        deletedAt: null,
        status: 'ACTIVE',
      }),
    });
  });
});
