import { describe, expect, it, vi } from 'vitest';
import { validateEnv } from '../../config/env.validation.js';

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
    const { AuthService } = await import('./auth.service.js');

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
    const { AuthService } = await import('./auth.service.js');

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
