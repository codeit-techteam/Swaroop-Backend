import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthErrorCode } from './types/auth.types.js';
import { AuthException } from './exceptions/auth.exception.js';
import { AuthService } from './auth.service.js';
import { MSG91_CHALLENGE_PREFIX } from './services/msg91-otp.client.js';

/**
 * Regression: when MSG91 manages the challenge, fixed demo OTP 123456 must not
 * authenticate, and verification must go through the provider.
 */
describe('AuthService MSG91 verify path', () => {
  const DEMO_PHONE = '+918240890242';
  const DEMO_OTP = '123456';

  const buildService = (opts: {
    fixedDevOtp: boolean;
    providerVerified?: boolean;
    providerMessage?: string;
    challengeHash: string;
  }) => {
    const record = {
      id: 'challenge-1',
      identifier: DEMO_PHONE,
      otpHash: opts.challengeHash,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      maxAttempts: 5,
      purpose: 'LOGIN',
    };

    const prisma = {
      otpVerification: {
        findFirst: vi.fn().mockResolvedValue(record),
        update: vi.fn().mockResolvedValue(record),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      ),
    };

    const otpDelivery = {
      isMsg91PhoneProvider: vi.fn().mockReturnValue(true),
      isMsg91Challenge: vi.fn(
        (hash: string) => hash.startsWith(MSG91_CHALLENGE_PREFIX),
      ),
      verifyPhoneWithProvider: vi.fn().mockResolvedValue({
        verified: opts.providerVerified ?? false,
        message: opts.providerMessage ?? 'OTP not match',
      }),
      encodeMsg91Challenge: vi.fn(),
      send: vi.fn(),
    };

    const configService = {
      get: vi.fn((key: string) => {
        if (key === 'security.authStrictOtp') return !opts.fixedDevOtp;
        if (key === 'security.authDevFixedOtp') return opts.fixedDevOtp;
        return undefined;
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = Object.create(AuthService.prototype) as any;
    service.prisma = prisma;
    service.otpDelivery = otpDelivery;
    service.configService = configService;
    service.crypto = { hashOtp: (v: string) => `hash:${v}` };
    service.logger = { log: vi.fn(), error: vi.fn() };
    service.issueSessionForIdentifier = vi.fn().mockResolvedValue({
      user: { id: 'u1' },
    });
    service.completeOtpLogin = vi.fn().mockResolvedValue({
      user: { id: 'u1' },
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 900,
    });
    service.bootstrapDemoIfNeeded = vi.fn().mockResolvedValue(undefined);
    service.resolveIdentifier = (dto: { phone?: string }) => ({
      identifier: dto.phone!,
      identifierType: 'PHONE',
    });

    return { service, otpDelivery, prisma };
  };

  it('rejects fixed demo OTP when MSG91 challenge is active even if fixed mode on', async () => {
    // Fixed shortcut runs before challenge lookup — ensure MSG91 lock disables it.
    const { service, otpDelivery } = buildService({
      fixedDevOtp: false,
      providerVerified: false,
      challengeHash: `${MSG91_CHALLENGE_PREFIX}req-1`,
    });

    await expect(
      service.verifyOtp({
        phone: DEMO_PHONE,
        otp: DEMO_OTP,
        purpose: 'LOGIN' as never,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: AuthErrorCode.AUTH_INVALID_OTP }),
    });

    expect(otpDelivery.verifyPhoneWithProvider).toHaveBeenCalledWith(
      DEMO_PHONE,
      DEMO_OTP,
    );
  });

  it('issues session only after MSG91 reports verified', async () => {
    const { service, otpDelivery, prisma } = buildService({
      fixedDevOtp: false,
      providerVerified: true,
      challengeHash: `${MSG91_CHALLENGE_PREFIX}req-1`,
    });

    const result = await service.verifyOtp({
      phone: DEMO_PHONE,
      otp: '482913',
      purpose: 'LOGIN' as never,
      roleHint: 'CUSTOMER',
    });

    expect(otpDelivery.verifyPhoneWithProvider).toHaveBeenCalledWith(
      DEMO_PHONE,
      '482913',
    );
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result.user.id).toBe('u1');
  });

  it('does not create a session when MSG91 times out / errors', async () => {
    const { service, otpDelivery, prisma } = buildService({
      fixedDevOtp: false,
      challengeHash: `${MSG91_CHALLENGE_PREFIX}req-1`,
    });
    otpDelivery.verifyPhoneWithProvider.mockRejectedValue(
      new Error('MSG91 OTP request timed out'),
    );

    await expect(
      service.verifyOtp({
        phone: DEMO_PHONE,
        otp: '482913',
        purpose: 'LOGIN' as never,
      }),
    ).rejects.toBeInstanceOf(AuthException);

    try {
      await service.verifyOtp({
        phone: DEMO_PHONE,
        otp: '482913',
        purpose: 'LOGIN' as never,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AuthException);
      const ex = error as AuthException;
      expect(ex.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    }

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
