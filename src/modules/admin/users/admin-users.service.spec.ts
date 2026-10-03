import { describe, expect, it, vi } from 'vitest';
import {
  AdminUsersService,
  assertCanManageUser,
} from './admin-users.service.js';

const admin = { id: 'admin-1', roles: ['ADMIN'] };
const superAdmin = { id: 'root-1', roles: ['SUPER_ADMIN'] };

function serviceFor(targetRoles: string[]) {
  const prisma = {
    user: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'target-1',
        status: 'ACTIVE',
        userRoles: targetRoles.map((code) => ({ role: { code } })),
      }),
    },
    role: { findUnique: vi.fn().mockResolvedValue({ id: 'r', code: 'X' }) },
    userRole: { count: vi.fn().mockResolvedValue(2) },
    $transaction: vi.fn(),
  };
  return {
    prisma,
    service: new AdminUsersService(prisma as never, { log: vi.fn() } as never),
  };
}

describe('admin user escalation guards', () => {
  it('an admin cannot change their own role or status', () => {
    expect(() => assertCanManageUser(admin, 'admin-1', ['ADMIN'])).toThrow(
      /your own/,
    );
  });

  it('an admin cannot modify another admin or super admin', () => {
    expect(() => assertCanManageUser(admin, 'x', ['SUPER_ADMIN'])).toThrow(
      /Super Admin/,
    );
    expect(() => assertCanManageUser(superAdmin, 'x', ['ADMIN'])).not.toThrow();
  });

  it('an admin cannot grant SUPER_ADMIN', async () => {
    const { service, prisma } = serviceFor(['CUSTOMER']);
    await expect(
      service.updateRole('target-1', { role: 'SUPER_ADMIN' as never }, admin),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('the generic role editor cannot create or alter Seller Managers', async () => {
    const { service } = serviceFor(['CUSTOMER']);
    await expect(
      service.updateRole(
        'target-1',
        { role: 'SELLER_MANAGER' as never },
        superAdmin,
      ),
    ).rejects.toMatchObject({ status: 400 });
    const manager = serviceFor(['SELLER_MANAGER']);
    await expect(
      manager.service.updateRole(
        'target-1',
        { role: 'ADMIN' as never },
        superAdmin,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
