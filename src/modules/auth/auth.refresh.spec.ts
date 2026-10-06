import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { AuthException } from './exceptions/auth.exception.js';

type SessionRow = {
  id: string;
  userId: string;
  familyId: string;
  refreshTokenHash: string;
  revokedAt: Date | null;
  replacedById: string | null;
  expiresAt: Date;
};

function setup(session: SessionRow, tokenMatches = true) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const update = vi.fn().mockResolvedValue({});
  const prisma = {
    authSession: {
      findUnique: vi.fn().mockResolvedValue(session),
      updateMany,
      update,
      findFirst: vi.fn().mockResolvedValue({ id: 'new-session' }),
    },
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 'u1', status: 'ACTIVE', deletedAt: null }),
    },
    $transaction: (fn: (tx: unknown) => unknown) => fn(prisma),
  };
  const jwt = {
    verifyAsync: vi.fn().mockResolvedValue({
      sub: 'u1',
      sessionId: session.id,
      familyId: session.familyId,
      type: 'refresh',
    }),
  };
  const crypto = {
    compareRefreshToken: vi.fn().mockResolvedValue(tokenMatches),
  };
  const service = new AuthService(
    prisma as never,
    jwt as never,
    { get: () => 'secret' } as unknown as ConfigService,
    crypto as never,
    {} as never,
    { isDemoUser: () => false } as never,
  );
  const internals = service as unknown as Record<string, unknown>;
  internals.createSession = vi.fn().mockResolvedValue({
    accessToken: 'access-2',
    refreshToken: 'refresh-2',
    expiresIn: 900,
  });
  internals.toPublicUser = vi.fn().mockResolvedValue({ id: 'u1', roles: [] });
  internals.assertUserCanAuthenticate = vi.fn();
  return { service, updateMany, update };
}

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 's1',
    userId: 'u1',
    familyId: 'f1',
    refreshTokenHash: 'hash',
    revokedAt: null,
    replacedById: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    ...overrides,
  };
}

describe('AuthService.refresh', () => {
  it('rotates an active refresh token', async () => {
    const { service, updateMany } = setup(session());
    await expect(service.refresh('refresh-1')).resolves.toMatchObject({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('allows a just-rotated token within the grace window', async () => {
    const revokedAt = new Date(Date.now() - 5_000);
    const { service, updateMany, update } = setup(
      session({ revokedAt, replacedById: 's2' }),
    );
    await expect(service.refresh('refresh-1')).resolves.toMatchObject({
      accessToken: 'access-2',
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revokedAt }),
      }),
    );
  });

  it('revokes the family when a rotated token is reused after the grace window', async () => {
    const { service, updateMany } = setup(
      session({
        revokedAt: new Date(Date.now() - 120_000),
        replacedById: 's2',
      }),
    );
    await expect(service.refresh('refresh-1')).rejects.toBeInstanceOf(
      AuthException,
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { familyId: 'f1', revokedAt: null } }),
    );
  });

  it('rejects a logged-out session even within the grace window', async () => {
    const { service, updateMany } = setup(
      session({ revokedAt: new Date(), replacedById: null }),
    );
    await expect(service.refresh('refresh-1')).rejects.toBeInstanceOf(
      AuthException,
    );
    expect(updateMany).toHaveBeenCalled();
  });

  it('rejects a rotated session when the token hash does not match', async () => {
    const { service } = setup(
      session({ revokedAt: new Date(), replacedById: 's2' }),
      false,
    );
    await expect(service.refresh('refresh-1')).rejects.toBeInstanceOf(
      AuthException,
    );
  });
});
