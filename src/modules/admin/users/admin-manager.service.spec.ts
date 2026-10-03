import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../../generated/prisma/client.js';
import { CryptoService } from '../../auth/services/crypto.service.js';
import { AdminManagerService } from './admin-manager.service.js';
import type { CreateSellerManagerDto } from './admin-users.dto.js';

const crypto = new CryptoService({
  get: (key: string) => (key === 'security.bcryptSaltRounds' ? 4 : undefined),
} as ConfigService);

const actor = { id: 'admin-1', ipAddress: '10.0.0.1', requestId: 'req-1' };

const sellerA = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'APPROVED',
  deletedAt: null,
  organizationId: 'org-a',
  organization: {
    id: 'org-a',
    code: 'SEL-000123',
    name: 'ABC Polymers Pvt Ltd',
    gstin: '27ABCDE1234F1Z5',
    pan: 'ABCDE1234F',
    deletedAt: null,
  },
};

function makePrisma() {
  const prisma = {
    role: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 'role-sm', code: 'SELLER_MANAGER' }),
      upsert: vi.fn(),
    },
    sellerProfile: { findFirst: vi.fn().mockResolvedValue(sellerA) },
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'mgr-1',
          loginId: data.loginId,
          status: data.status,
        }),
      ),
      update: vi.fn(),
    },
    userRole: { create: vi.fn() },
    sellerManagerAssignment: {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    userPermissionGrant: { createMany: vi.fn(), deleteMany: vi.fn() },
    passwordResetToken: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    authSession: { updateMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    auditLog: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([{ n: 7n }]),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  return prisma;
}

function dto(
  over: Partial<CreateSellerManagerDto> = {},
): CreateSellerManagerDto {
  return {
    name: '  Rahul   Sharma ',
    email: 'Rahul@Example.com',
    phone: '98765 43210',
    sellerId: sellerA.id,
    role: 'SELLER_MANAGER',
    permissions: ['orders.view', 'inventory.view', 'logistics.manage'],
    ...over,
  } as CreateSellerManagerDto;
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { getStatus(): number; getResponse(): { code?: string } };
  }
  throw new Error('expected rejection');
}

describe('AdminManagerService.create', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AdminManagerService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new AdminManagerService(prisma as never, crypto);
  });

  it('creates user, role, seller assignment, grants, invitation, and audit in one transaction', async () => {
    const result = await service.create(dto(), actor);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const userData = prisma.user.create.mock.calls[0][0].data;
    expect(userData).toMatchObject({
      email: 'rahul@example.com',
      phone: '+919876543210',
      displayName: 'Rahul Sharma',
      loginId: 'PTM-000007',
      passwordHash: null,
      status: 'PENDING',
    });
    expect(prisma.userRole.create).toHaveBeenCalledWith({
      data: { userId: 'mgr-1', roleId: 'role-sm' },
    });
    expect(
      prisma.sellerManagerAssignment.create.mock.calls[0][0].data,
    ).toMatchObject({
      userId: 'mgr-1',
      sellerProfileId: sellerA.id,
      status: 'ACTIVE',
      assignedById: 'admin-1',
    });
    const grants =
      prisma.userPermissionGrant.createMany.mock.calls[0][0].data.map(
        (row: { code: string }) => row.code,
      );
    expect(grants).toEqual(
      expect.arrayContaining([
        'orders.view',
        'inventory.view',
        'logistics.manage',
      ]),
    );

    const token = prisma.passwordResetToken.create.mock.calls[0][0].data;
    expect(token.purpose).toBe('INVITATION');
    expect(result.invitation?.token).toBeTruthy();
    expect(token.tokenHash).toBe(crypto.hashToken(result.invitation!.token));
    expect(token.tokenHash).not.toBe(result.invitation!.token);
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const actions = prisma.auditLog.create.mock.calls.map(
      (c) => c[0].data.action,
    );
    expect(actions).toContain('SELLER_MANAGER_CREATED');
    expect(actions).toContain('MANAGER_ASSIGNED_TO_SELLER');
    const created = prisma.auditLog.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      actorUserId: 'admin-1',
      entityId: 'mgr-1',
      organizationId: 'org-a',
      ipAddress: '10.0.0.1',
      metadata: { requestId: 'req-1' },
    });
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain(
      result.invitation!.token,
    );

    expect(result).toMatchObject({
      role: 'SELLER_MANAGER',
      status: 'PENDING',
      seller: {
        id: sellerA.id,
        name: 'ABC Polymers Pvt Ltd',
        code: 'SEL-000123',
      },
    });
    expect(result).not.toHaveProperty('temporaryPassword');
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('stores only a hash for a temporary password and never returns or audits it', async () => {
    const secret = 'Temp@Pass99';
    const result = await service.create(
      dto({ accessMethod: 'TEMPORARY_PASSWORD', temporaryPassword: secret }),
      actor,
    );
    const userData = prisma.user.create.mock.calls[0][0].data;
    expect(userData.passwordHash).not.toBe(secret);
    await expect(
      crypto.comparePassword(secret, userData.passwordHash),
    ).resolves.toBe(true);
    expect(userData.mustChangePassword).toBe(true);
    expect(userData.status).toBe('ACTIVE');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain(
      secret,
    );
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('rejects a seller that is not approved', async () => {
    prisma.sellerProfile.findFirst.mockResolvedValue({
      ...sellerA,
      status: 'SUSPENDED',
    });
    const error = await errorOf(service.create(dto(), actor));
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse().code).toBe('SELLER_NOT_ACTIVE');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown seller', async () => {
    prisma.sellerProfile.findFirst.mockResolvedValue(null);
    const error = await errorOf(service.create(dto(), actor));
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse().code).toBe('SELLER_NOT_FOUND');
  });

  it('rejects a duplicate email', async () => {
    prisma.user.findFirst.mockResolvedValue({
      email: 'rahul@example.com',
      phone: null,
    });
    const error = await errorOf(service.create(dto(), actor));
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: 'EMAIL_ALREADY_EXISTS',
      message: 'This email is already registered.',
    });
  });

  it('rejects a duplicate mobile', async () => {
    prisma.user.findFirst.mockResolvedValue({
      email: 'x@y.com',
      phone: '+919876543210',
    });
    const error = await errorOf(service.create(dto(), actor));
    expect(error.getResponse()).toMatchObject({
      code: 'MOBILE_ALREADY_EXISTS',
      message: 'This mobile number is already registered.',
    });
  });

  it('rejects any role other than SELLER_MANAGER', async () => {
    const error = await errorOf(
      service.create(dto({ role: 'SUPER_ADMIN' as never }), actor),
    );
    expect(error.getResponse().code).toBe('INVALID_ROLE');
    expect(prisma.sellerProfile.findFirst).not.toHaveBeenCalled();
  });

  it('rejects admin or customer permission codes', async () => {
    const error = await errorOf(
      service.create(
        dto({ permissions: ['orders.view', 'USER_WRITE'] }),
        actor,
      ),
    );
    expect(error.getResponse().code).toBe('INVALID_PERMISSIONS');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('maps a concurrent duplicate insert (double click) to a conflict', async () => {
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['email'] },
      }),
    );
    const error = await errorOf(service.create(dto(), actor));
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse().code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('propagates a failure inside the transaction so nothing is committed', async () => {
    prisma.sellerManagerAssignment.create.mockRejectedValue(
      new Error('db down'),
    );
    await expect(service.create(dto(), actor)).rejects.toThrow('db down');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('AdminManagerService lifecycle', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AdminManagerService;
  const managerRow = {
    id: 'mgr-1',
    phone: '+919876543210',
    status: 'ACTIVE',
    passwordHash: 'hash',
    userRoles: [{ role: { code: 'SELLER_MANAGER' } }],
    permissionGrants: [{ code: 'orders.view' }],
    managerAssignments: [
      {
        id: 'asg-1',
        sellerProfileId: sellerA.id,
        status: 'ACTIVE',
        title: null,
      },
    ],
  };

  beforeEach(() => {
    prisma = makePrisma();
    prisma.user.findFirst.mockResolvedValue(managerRow);
    service = new AdminManagerService(prisma as never, crypto);
    vi.spyOn(service, 'detail').mockResolvedValue({} as never);
  });

  it('reassigning to another seller ends old access and revokes sessions', async () => {
    const sellerB = {
      ...sellerA,
      id: '22222222-2222-4222-8222-222222222222',
      organizationId: 'org-b',
    };
    prisma.sellerProfile.findFirst.mockResolvedValue(sellerB);
    await service.update('mgr-1', { sellerId: sellerB.id }, actor);

    expect(prisma.sellerManagerAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'asg-1' },
        data: expect.objectContaining({ status: 'INACTIVE' }),
      }),
    );
    expect(
      prisma.sellerManagerAssignment.create.mock.calls[0][0].data,
    ).toMatchObject({
      sellerProfileId: sellerB.id,
      status: 'ACTIVE',
    });
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'mgr-1', revokedAt: null } }),
    );
  });

  it('refuses reassignment to a seller that is not approved', async () => {
    prisma.sellerProfile.findFirst.mockResolvedValue({
      ...sellerA,
      id: '33333333-3333-4333-8333-333333333333',
      status: 'REJECTED',
    });
    const error = await errorOf(
      service.update(
        'mgr-1',
        { sellerId: '33333333-3333-4333-8333-333333333333' },
        actor,
      ),
    );
    expect(error.getResponse().code).toBe('SELLER_NOT_ACTIVE');
    expect(prisma.sellerManagerAssignment.create).not.toHaveBeenCalled();
  });

  it('replaces permission grants and audits old and new sets', async () => {
    await service.update('mgr-1', { permissions: ['inventory.view'] }, actor);
    expect(prisma.userPermissionGrant.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'mgr-1' },
    });
    const audit = prisma.auditLog.create.mock.calls.find(
      (c) => c[0].data.action === 'MANAGER_PERMISSION_UPDATED',
    )?.[0].data;
    expect(audit.previousData).toEqual({ permissions: ['orders.view'] });
    expect(audit.newData.permissions).toContain('inventory.view');
  });

  it('deactivation revokes sessions and voids unused invitation links', async () => {
    await service.deactivate('mgr-1', actor);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'mgr-1' },
      data: { status: 'INACTIVE' },
    });
    expect(prisma.authSession.updateMany).toHaveBeenCalled();
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'mgr-1', usedAt: null } }),
    );
  });

  it('re-sends an invitation when the manager never set a password', async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...managerRow,
      passwordHash: null,
    });
    const result = await service.resetPassword('mgr-1', actor);
    expect(result.purpose).toBe('INVITATION');
    expect(prisma.passwordResetToken.create.mock.calls[0][0].data.purpose).toBe(
      'INVITATION',
    );
  });

  it('refuses lifecycle actions on users who are not Seller Managers', async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...managerRow,
      userRoles: [{ role: { code: 'ADMIN' } }],
    });
    const error = await errorOf(service.deactivate('mgr-1', actor));
    expect(error.getResponse().code).toBe('NOT_A_MANAGER');
  });
});
