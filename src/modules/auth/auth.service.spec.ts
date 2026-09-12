import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AuthException } from './exceptions/auth.exception.js';
import { AuthErrorCode } from './types/auth.types.js';
import { CryptoService } from './services/crypto.service.js';
import { ConfigService } from '@nestjs/config';

describe('CryptoService', () => {
  const crypto = new CryptoService({
    get: (key: string) => {
      if (key === 'security.bcryptSaltRounds') return 10;
      return undefined;
    },
  } as ConfigService);

  it('hashes and verifies passwords', async () => {
    const hash = await crypto.hashPassword('Test@12345');
    expect(hash).not.toContain('Test@12345');
    await expect(crypto.comparePassword('Test@12345', hash)).resolves.toBe(
      true,
    );
    await expect(crypto.comparePassword('wrong', hash)).resolves.toBe(false);
  });

  it('generates numeric OTPs of configured length', () => {
    const otp = crypto.generateOtp(6);
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('hashes OTPs deterministically without storing plaintext', () => {
    const hash = crypto.hashOtp('123456');
    expect(hash).toHaveLength(64);
    expect(hash).toBe(crypto.hashOtp('123456'));
    expect(hash).not.toBe('123456');
  });
});

describe('AuthException', () => {
  it('includes auth error code in response payload', () => {
    const err = new AuthException(
      AuthErrorCode.AUTH_INVALID_CREDENTIALS,
      'Invalid credentials',
      HttpStatus.UNAUTHORIZED,
    );
    expect(err.getStatus()).toBe(401);
    expect(err.getResponse()).toMatchObject({
      code: AuthErrorCode.AUTH_INVALID_CREDENTIALS,
      message: 'Invalid credentials',
    });
  });
});
