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
 * Fixed OTP is FAIL-CLOSED: off by default, off in production/staging no matter
 * what flags are set, and only enabled outside production when explicitly opted in.
 */
describe('resolveFixedDevOtp (configuration)', () => {
  it('is OFF by default (no flag set), including in production', async () => {
    expect(resolveFixedDevOtp({ NODE_ENV: 'production' })).toBe(false);
    expect(resolveFixedDevOtp({ NODE_ENV: 'development' })).toBe(false);
    expect(resolveFixedDevOtp({})).toBe(false);
  });

  it('can never be enabled in production or staging', async () => {
    for (const NODE_ENV of ['production', 'staging', 'PRODUCTION']) {
      expect(
        resolveFixedDevOtp({ NODE_ENV, AUTH_DEV_FIXED_OTP: 'true' }),
      ).toBe(false);
    }
  });

  it('is ON only outside production with an explicit AUTH_DEV_FIXED_OTP=true', async () => {
    expect(
      resolveFixedDevOtp({ NODE_ENV: 'development', AUTH_DEV_FIXED_OTP: 'true' }),
    ).toBe(true);
    expect(
      resolveFixedDevOtp({ NODE_ENV: 'development', AUTH_DEV_FIXED_OTP: 'false' }),
    ).toBe(false);
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

  it('disables fixed OTP when MSG91 provider credentials are present', async () => {
    expect(
      resolveFixedDevOtp({
        NODE_ENV: 'production',
        OTP_PROVIDER: 'msg91',
        MSG91_AUTH_KEY: 'live-key',
        AUTH_DEV_FIXED_OTP: 'true',
      }),
    ).toBe(false);
  });

  it('keeps an opted-in dev bypass when OTP_PROVIDER=msg91 but auth key is empty', async () => {
    expect(
      resolveFixedDevOtp({
        NODE_ENV: 'development',
        OTP_PROVIDER: 'msg91',
        MSG91_AUTH_KEY: '',
        AUTH_DEV_FIXED_OTP: 'true',
      }),
    ).toBe(true);
  });
});

describe('MSG91 production env validation', () => {
  const msg91Env = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/swaroop',
    JWT_ACCESS_SECRET: 'production-access-secret-min-32-characters!!',
    JWT_REFRESH_SECRET: 'production-refresh-secret-min-32-characters!',
    CORS_ORIGINS: 'https://app.swaroop.example',
  };

  it('requires MSG91 credentials when OTP_PROVIDER=msg91', () => {
    expect(() =>
      validateEnv({
        ...msg91Env,
        NODE_ENV: 'development',
        OTP_PROVIDER: 'msg91',
        MSG91_AUTH_KEY: '',
        MSG91_OTP_TEMPLATE_ID: '',
      }),
    ).toThrow(/MSG91_AUTH_KEY|MSG91_OTP_TEMPLATE_ID/);
  });

  it('accepts MSG91 configuration with template id', () => {
    const env = validateEnv({
      ...msg91Env,
      NODE_ENV: 'production',
      AUTH_STRICT_OTP: 'true',
      AUTH_DEV_EXPOSE_OTP: 'false',
      OTP_PROVIDER: 'msg91',
      MSG91_AUTH_KEY: 'production-msg91-auth-key',
      MSG91_OTP_TEMPLATE_ID: '6ae081288c342f46e203bb12',
      MSG91_HEADER: 'VELPLY',
    });
    expect(env.OTP_PROVIDER).toBe('msg91');
    expect(env.MSG91_OTP_TEMPLATE_ID).toBe('6ae081288c342f46e203bb12');
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

/**
 * Abuse controls on OTP send + production provider requirement.
 */
describe('AuthService.sendOtp abuse controls', () => {
  const PHONE = '+919999900001';

  const build = (opts: { sentLastHour: number; recent?: boolean }) => {
    const prisma = {
      otpVerification: {
        findFirst: vi.fn().mockResolvedValue(
          opts.recent ? { createdAt: new Date() } : null,
        ),
        count: vi.fn().mockResolvedValue(opts.sentLastHour),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({ id: 'c1' }),
      },
    };
    const otpDelivery = {
      isMsg91PhoneProvider: vi.fn().mockReturnValue(true),
      send: vi.fn().mockResolvedValue({ provider: 'msg91', providerRequestId: 'r1' }),
      encodeMsg91Challenge: vi.fn((id: string) => `msg91:${id}`),
    };
    const config: Record<string, unknown> = {
      'security.otpResendCooldownSeconds': 60,
      'security.otpExpiresInSeconds': 300,
      'security.otpMaxAttempts': 5,
      'security.otpLength': 6,
      'security.otpMaxSendsPerHour': 5,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = Object.create(AuthService.prototype) as any;
    service.prisma = prisma;
    service.otpDelivery = otpDelivery;
    service.configService = { get: (k: string) => config[k] };
    service.logger = { log: vi.fn(), error: vi.fn() };
    service.resolveIdentifier = () => ({
      identifier: PHONE,
      identifierType: 'PHONE',
    });
    service.findUserByIdentifier = vi.fn().mockResolvedValue(null);
    return { service, prisma, otpDelivery };
  };

  it('enforces the resend cooldown', async () => {
    const { service, otpDelivery } = build({ sentLastHour: 1, recent: true });
    await expect(service.sendOtp({ phone: PHONE })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AUTH_OTP_RATE_LIMITED' }),
    });
    expect(otpDelivery.send).not.toHaveBeenCalled();
  });

  it('enforces the per-hour send cap before calling the SMS provider', async () => {
    const { service, otpDelivery } = build({ sentLastHour: 5 });
    await expect(service.sendOtp({ phone: PHONE })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AUTH_OTP_RATE_LIMITED' }),
    });
    expect(otpDelivery.send).not.toHaveBeenCalled();
  });

  it('sends via provider under the cap and never returns the OTP', async () => {
    const { service, otpDelivery } = build({ sentLastHour: 2 });
    const result = await service.sendOtp({ phone: PHONE });
    expect(otpDelivery.send).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty('devOtp');
    expect(JSON.stringify(result)).not.toMatch(/\b\d{6}\b/);
  });
});

describe('OtpDeliveryService production fail-closed', () => {
  it('refuses phone OTP in production when MSG91 is not configured', async () => {
    const { OtpDeliveryService } = await import(
      './services/otp-delivery.service.js'
    );
    const config = {
      get: (key: string) =>
        ({
          'app.env': 'production',
          'otp.requireProviderInProduction': true,
        })[key],
    };
    const msg91 = { isConfigured: () => false };
    const svc = new OtpDeliveryService(config as never, msg91 as never);
    await expect(
      svc.send({
        identifier: '+919999900001',
        identifierType: 'PHONE',
        purpose: 'LOGIN',
        otp: '123456',
      }),
    ).rejects.toThrow(/not configured/i);
  });
});
