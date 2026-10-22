import { describe, expect, it, vi } from 'vitest';
import { validateEnv } from '../../config/env.validation.js';

/**
 * Production must never accept a fixed OTP bypass via environment flags.
 * AUTH_DEV_FIXED_OTP / AUTH_DEV_EXPOSE_OTP fail env validation in production.
 */
describe('Production OTP security', () => {
  const baseEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/swaroop',
    JWT_ACCESS_SECRET: 'production-access-secret-min-32-characters!!',
    JWT_REFRESH_SECRET: 'production-refresh-secret-min-32-characters!',
    CORS_ORIGINS: 'https://app.swaroop.example',
    NODE_ENV: 'production' as const,
  };

  it('rejects AUTH_DEV_FIXED_OTP=true in production', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        AUTH_DEV_FIXED_OTP: 'true',
      }),
    ).toThrow(/AUTH_DEV_FIXED_OTP/);
  });

  it('rejects AUTH_DEV_EXPOSE_OTP=true in production', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        AUTH_DEV_EXPOSE_OTP: 'true',
      }),
    ).toThrow(/AUTH_DEV_EXPOSE_OTP/);
  });

  it('allows production boot when OTP bypass flags are false', () => {
    const env = validateEnv({
      ...baseEnv,
      AUTH_DEV_FIXED_OTP: 'false',
      AUTH_DEV_EXPOSE_OTP: 'false',
    });
    expect(env.AUTH_DEV_FIXED_OTP).toBe(false);
    expect(env.AUTH_DEV_EXPOSE_OTP).toBe(false);
  });
});

describe('AuthService.isFixedDevOtpEnabled production hard-block', () => {
  it('never enables fixed OTP when app.env is production', async () => {
    const { AuthService } = await import('./auth.service.js');

    const configGet = vi.fn((key: string) => {
      if (key === 'app.env') return 'production';
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

  it('enables fixed OTP only when non-production and flag is true', async () => {
    const { AuthService } = await import('./auth.service.js');

    const configGet = vi.fn((key: string) => {
      if (key === 'app.env') return 'development';
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
