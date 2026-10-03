import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { RolesGuard } from './auth.guards.js';

function context(
  user: Record<string, unknown>,
  method: string,
  url: string,
): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ user, method, originalUrl: url }),
    }),
  } as unknown as ExecutionContext;
}

function guard(
  roles: string[],
  db: { assignment?: unknown; grant?: unknown } = {},
) {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(roles),
  } as unknown as Reflector;
  const prisma = {
    sellerManagerAssignment: {
      findFirst: vi.fn().mockResolvedValue(db.assignment ?? null),
    },
    userPermissionGrant: {
      findFirst: vi.fn().mockResolvedValue(db.grant ?? null),
    },
  };
  return { guard: new RolesGuard(reflector, prisma as never), prisma };
}

const manager = {
  id: 'mgr-1',
  roles: ['SELLER_MANAGER'],
  mustChangePassword: false,
};

describe('RolesGuard for Seller Managers', () => {
  it('blocks a manager from admin APIs', async () => {
    const { guard: g } = guard(['ADMIN', 'SUPER_ADMIN']);
    await expect(
      g.canActivate(context(manager, 'POST', '/api/v1/admin/users/managers')),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('blocks a manager from customer APIs even on seller-role routes', async () => {
    const { guard: g } = guard(['SELLER'], {
      assignment: { id: 'a' },
      grant: { id: 'g' },
    });
    await expect(
      g.canActivate(context(manager, 'GET', '/api/v1/customer/orders')),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('allows a seller route only with an active assignment and the matching grant', async () => {
    const { guard: g, prisma } = guard(['SELLER'], {
      assignment: { id: 'a' },
      grant: { id: 'g' },
    });
    await expect(
      g.canActivate(
        context(manager, 'GET', '/api/v1/seller/orders?sellerId=other'),
      ),
    ).resolves.toBe(true);
    expect(prisma.userPermissionGrant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'mgr-1', code: 'orders.view' },
      }),
    );
  });

  it('requires the manage permission for writes', async () => {
    const { guard: g, prisma } = guard(['SELLER'], { assignment: { id: 'a' } });
    await expect(
      g.canActivate(context(manager, 'PATCH', '/api/v1/seller/inventory/abc')),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.userPermissionGrant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'mgr-1', code: 'inventory.manage' },
      }),
    );
  });

  it('denies a manager whose seller assignment was revoked or moved', async () => {
    const { guard: g } = guard(['SELLER'], { grant: { id: 'g' } });
    await expect(
      g.canActivate(context(manager, 'GET', '/api/v1/seller/orders')),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('denies seller onboarding to managers', async () => {
    const { guard: g } = guard(['SELLER'], {
      assignment: { id: 'a' },
      grant: { id: 'g' },
    });
    await expect(
      g.canActivate(
        context(manager, 'POST', '/api/v1/seller/onboarding/company'),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('blocks every role-protected API until a temporary password is changed', async () => {
    const { guard: g } = guard(['SELLER'], {
      assignment: { id: 'a' },
      grant: { id: 'g' },
    });
    await expect(
      g.canActivate(
        context(
          { ...manager, mustChangePassword: true },
          'GET',
          '/api/v1/seller/orders',
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('does not let a customer reach seller routes', async () => {
    const { guard: g } = guard(['SELLER']);
    await expect(
      g.canActivate(
        context(
          { id: 'c1', roles: ['CUSTOMER'] },
          'GET',
          '/api/v1/seller/orders',
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
