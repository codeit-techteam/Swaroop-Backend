import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.validation.js';

describe('validateEnv', () => {
  it('accepts a valid development configuration', () => {
    const result = validateEnv({
      APP_NAME: 'swaroop-backend',
      NODE_ENV: 'development',
      PORT: '3000',
      API_PREFIX: 'api',
      API_VERSION: '1',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/swaroop',
      JWT_SECRET: 'dev-secret',
      JWT_EXPIRES_IN: '7d',
      CORS_ORIGINS: 'http://localhost:3000',
      LOG_LEVEL: 'info',
    });

    expect(result.APP_NAME).toBe('swaroop-backend');
    expect(result.PORT).toBe(3000);
  });

  it('rejects production config with placeholder JWT secret', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@host:5432/db',
        JWT_SECRET: 'change-me',
        CORS_ORIGINS: 'https://app.example.com',
        STORAGE_PROVIDER: 'none',
      }),
    ).toThrow(/Environment validation failed/);
  });

  it('allows production without R2 when STORAGE_PROVIDER=none', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@host:5432/db',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      CORS_ORIGINS: 'https://app.example.com',
      STORAGE_PROVIDER: 'none',
      AUTH_DEV_EXPOSE_OTP: 'false',
    });
    expect(result.STORAGE_PROVIDER).toBe('none');
  });

  it('requires R2 credentials in production when STORAGE_PROVIDER=r2', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@host:5432/db',
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        JWT_REFRESH_SECRET: 'b'.repeat(32),
        CORS_ORIGINS: 'https://app.example.com',
        STORAGE_PROVIDER: 'r2',
        AUTH_DEV_EXPOSE_OTP: 'false',
      }),
    ).toThrow(/R2_ACCOUNT_ID/);
  });
});
