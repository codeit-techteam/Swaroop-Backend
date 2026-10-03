import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';
import { CryptoService } from './services/crypto.service.js';

const crypto = new CryptoService({
  get: (key: string) => (key === 'security.bcryptSaltRounds' ? 4 : undefined),
} as ConfigService);

function build(prismaOverrides: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose Prisma test double
  const prisma: Record<string, any> = {
    passwordResetToken: {
      findFirst: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findUnique: vi.fn(), update: vi.fn() },
    authSession: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    userRole: { findFirst: vi.fn().mockResolvedValue(null) },
    sellerProfile: { findFirst: vi.fn().mockResolvedValue(null) },
    sellerManagerAssignment: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
    ...prismaOverrides,
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  const service = new AuthService(
    prisma as never,
    {} as never,
    { get: () => undefined } as unknown as ConfigService,
    crypto,
    {} as never,
    { isDemoUser: () => false } as never,
  );
  return { prisma, service };
}

const token = 'x'.repeat(43);

describe('invitation / password reset', () => {
  it('activates a pending manager and consumes the invitation once', async () => {
    const { prisma, service } = build();
    prisma.passwordResetToken.findFirst.mockResolvedValue({
      id: 't1',
      userId: 'mgr-1',
      purpose: 'INVITATION',
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.user.findUnique.mockResolvedValue({
      status: 'PENDING',
      deletedAt: null,
    });

    await service.resetPassword({ token, newPassword: 'Manager@123' });

    const update = prisma.user.update.mock.calls[0][0];
    expect(update.data.status).toBe('ACTIVE');
    expect(update.data.passwordHash).not.toBe('Manager@123');
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1', usedAt: null } }),
    );
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe(
      'MANAGER_INVITATION_ACCEPTED',
    );
  });

  it('never reactivates a suspended or deactivated account', async () => {
    const { prisma, service } = build();
    prisma.passwordResetToken.findFirst.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      purpose: 'PASSWORD_RESET',
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.user.findUnique.mockResolvedValue({
      status: 'SUSPENDED',
      deletedAt: null,
    });

    await service.resetPassword({ token, newPassword: 'Manager@123' });

    expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty(
      'status',
    );
  });

  it('rejects a token that was consumed concurrently', async () => {
    const { prisma, service } = build();
    prisma.passwordResetToken.findFirst.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      purpose: 'INVITATION',
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.user.findUnique.mockResolvedValue({
      status: 'PENDING',
      deletedAt: null,
    });
    prisma.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.resetPassword({ token, newPassword: 'Manager@123' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    const { prisma, service } = build();
    prisma.passwordResetToken.findFirst.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      expiresAt: new Date(Date.now() - 1),
    });
    await expect(
      service.resetPassword({ token, newPassword: 'Manager@123' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('change password', () => {
  it('clears the forced password change flag and signs out every session', async () => {
    const { prisma, service } = build();
    prisma.user.findUnique.mockResolvedValue({
      id: 'mgr-1',
      passwordHash: await crypto.hashPassword('Temp@Pass99'),
    });
    await service.changePassword(
      { id: 'mgr-1', roles: ['SELLER_MANAGER'] } as never,
      { currentPassword: 'Temp@Pass99', newPassword: 'Manager@123' },
    );
    expect(prisma.user.update.mock.calls[0][0].data.mustChangePassword).toBe(
      false,
    );
    expect(prisma.authSession.updateMany).toHaveBeenCalled();
  });
});

describe('manager login', () => {
  it('refuses a manager with no active seller assignment', async () => {
    const { prisma, service } = build();
    const passwordHash = await crypto.hashPassword('Manager@123');
    prisma.user.findUnique.mockResolvedValue({
      id: 'mgr-1',
      status: 'ACTIVE',
      passwordHash,
    });
    prisma.userRole.findFirst.mockResolvedValue({ id: 'ur' });

    await expect(
      service.login({ identifier: 'PTM-000001', password: 'Manager@123' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses a deactivated manager', async () => {
    const { prisma, service } = build();
    prisma.user.findUnique.mockResolvedValue({
      id: 'mgr-1',
      status: 'INACTIVE',
      passwordHash: await crypto.hashPassword('Manager@123'),
    });
    await expect(
      service.login({ identifier: 'PTM-000001', password: 'Manager@123' }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
