import { describe, expect, it, vi } from 'vitest';
import { resolveFixedDevOtp } from '../../config/configuration.js';
import { validateEnv } from '../../config/env.validation.js';
import { AuthService } from './auth.service.js';
import { DemoBootstrapService } from './services/demo-bootstrap.service.js';

/**
 * AUTH_STRICT_OTP is the real SMS production lock.
 * Until then, demo phone +918240890242 accepts OTP 123456.
 */
describe('Production OTP security', () => {
  const baseEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/swaroop',
    JWT_ACCESS_SECRET: 'production-access-secret-min-32-characters!!',
    JWT_REFRESH_SECRET: 'production-refresh-secret-min-32-characters!',
    CORS_ORIGINS: 'https://app.swaroop.example',
    NODE_ENV: 'production' as const,
  };

  it('rejects AUTH_DEV_EXPOSE_OTP=true in production', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        AUTH_DEV_EXPOSE_OTP: 'true',
      }),
    ).toThrow(/AUTH_DEV_EXPOSE_OTP/);
  });

  it('rejects AUTH_DEV_EXPOSE_OTP when AUTH_STRICT_OTP is on', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        AUTH_STRICT_OTP: 'true',
        AUTH_DEV_EXPOSE_OTP: 'true',
        AUTH_DEV_FIXED_OTP: 'false',
      }),
    ).toThrow(/AUTH_DEV_EXPOSE_OTP/);
  });

  it('allows development-phase boot in production without AUTH_STRICT_OTP', () => {
    const env = validateEnv({
      ...baseEnv,
      AUTH_DEV_FIXED_OTP: 'true',
      AUTH_DEV_EXPOSE_OTP: 'false',
      AUTH_STRICT_OTP: 'false',
    });
    expect(env.AUTH_STRICT_OTP).toBe(false);
  });

  it('allows production boot when AUTH_STRICT_OTP is enabled', () => {
    const env = validateEnv({
      ...baseEnv,
      AUTH_STRICT_OTP: 'true',
      AUTH_DEV_FIXED_OTP: 'false',
      AUTH_DEV_EXPOSE_OTP: 'false',
    });
    expect(env.AUTH_STRICT_OTP).toBe(true);
  });
});

describe('AuthService.isFixedDevOtpEnabled', () => {
  it('never enables fixed OTP when AUTH_STRICT_OTP is on', async () => {
    const configGet = vi.fn((key: string) => {
      if (key === 'security.authStrictOtp') return true;
      if (key === 'security.authDevFixedOtp') return true;
      return undefined;
    });

    const service = Object.create(AuthService.prototype) as AuthService & {
      configService: { get: typeof configGet };
      isFixedDevOtpEnabled: () => boolean;
    };
    service.configService = { get: configGet };

    expect(service['isFixedDevOtpEnabled']()).toBe(false);
  });

  it('enables fixed OTP when AUTH_STRICT_OTP is off and flag is true', async () => {
    const configGet = vi.fn((key: string) => {
      if (key === 'security.authStrictOtp') return false;
      if (key === 'security.authDevFixedOtp') return true;
      return undefined;
    });

    const service = Object.create(AuthService.prototype) as AuthService & {
      configService: { get: typeof configGet };
      isFixedDevOtpEnabled: () => boolean;
    };
    service.configService = { get: configGet };

    expect(service['isFixedDevOtpEnabled']()).toBe(true);
  });
});

/**
 * Development phase: fixed OTP stays ON until AUTH_STRICT_OTP locks real SMS.
 * AUTH_DEV_FIXED_OTP cannot disable it while the SMS lock is off.
 */
describe('resolveFixedDevOtp (configuration)', () => {
  it('is ON in production during the development phase', async () => {
    expect(resolveFixedDevOtp({ NODE_ENV: 'production' })).toBe(true);
    expect(
      resolveFixedDevOtp({ NODE_ENV: 'production', AUTH_DEV_FIXED_OTP: 'false' }),
    ).toBe(true);
  });

  it('stays ON outside production until AUTH_STRICT_OTP', async () => {
    expect(resolveFixedDevOtp({ NODE_ENV: 'development' })).toBe(true);
    expect(
      resolveFixedDevOtp({ NODE_ENV: 'development', AUTH_DEV_FIXED_OTP: 'false' }),
    ).toBe(true);
  });

  it('AUTH_STRICT_OTP=true always wins', async () => {
    expect(
      resolveFixedDevOtp({
        NODE_ENV: 'development',
        AUTH_STRICT_OTP: 'true',
        AUTH_DEV_FIXED_OTP: 'true',
      }),
    ).toBe(false);
  });
});

/**
 * A-05: demo accounts shipped with the well-known password `Test@12345`.
 * With demo mode off the bootstrap must rotate it; with demo mode on it must
 * leave the accounts alone.
 */
describe('DemoBootstrapService.lockDemoCredentialsIfNeeded', () => {
  const makeService = async (demoMode: boolean, users: Array<Record<string, unknown>>) => {
    const update = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue(users),
        update,
      },
    };
    const crypto = {
      comparePassword: vi.fn(
        async (password: string, hash: string) => hash === `hash:${password}`,
      ),
      hashPassword: vi.fn(async (password: string) => `hash:${password}`),
      generateSecureToken: vi.fn(() => 'random-secret'),
    };
    const configService = {
      get: vi.fn((key: string) => {
        if (key === 'security.authStrictOtp') return false;
        if (key === 'security.authDevFixedOtp') return demoMode;
        return undefined;
      }),
    };
    const service = Object.create(DemoBootstrapService.prototype) as InstanceType<
      typeof DemoBootstrapService
    > & { prisma: typeof prisma; crypto: typeof crypto; configService: typeof configService };
    service.prisma = prisma;
    service.crypto = crypto;
    service.configService = configService;
    (service as unknown as { logger: { warn: () => void; error: () => void } }).logger = {
      warn: vi.fn(),
      error: vi.fn(),
    };
    return { service, prisma, crypto, update };
  };

  it('rotates the known demo password when demo mode is off', async () => {
    const { service, update } = await makeService(false, [
      { id: 'u1', email: 'customer@test.local', passwordHash: 'hash:Test@12345' },
      { id: 'u2', email: 'seller@test.local', passwordHash: 'hash:already-rotated' },
    ]);

    const rotated = await service.lockDemoCredentialsIfNeeded();

    expect(rotated).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordHash: 'hash:random-secret' },
    });
  });

  it('leaves accounts already on the demo password alone while demo mode is on', async () => {
    const { service, update } = await makeService(true, [
      { id: 'u1', email: 'customer@test.local', passwordHash: 'hash:Test@12345' },
    ]);

    const changed = await service.lockDemoCredentialsIfNeeded();

    expect(changed).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('restores the demo password when demo mode is on and it was rotated', async () => {
    const { service, update } = await makeService(true, [
      { id: 'u1', email: 'customer@test.local', passwordHash: 'hash:already-rotated' },
    ]);

    const changed = await service.lockDemoCredentialsIfNeeded();

    expect(changed).toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordHash: 'hash:Test@12345' },
    });
  });
});
