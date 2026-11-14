import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerKycApprovedGuard } from './customer-kyc-approved.guard.js';

describe('CustomerKycApprovedGuard', () => {
  const config = { get: vi.fn() };
  const prisma = {
    customerProfile: { findFirst: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function context(userId?: string) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: userId ? { id: userId } : undefined }),
      }),
    } as never;
  }

  it('allows trading when KYC_ENFORCE_FOR_TRADING is off', async () => {
    config.get.mockReturnValue(false);
    const guard = new CustomerKycApprovedGuard(config as never, prisma as never);
    await expect(guard.canActivate(context('u1'))).resolves.toBe(true);
    expect(prisma.customerProfile.findFirst).not.toHaveBeenCalled();
  });

  it('blocks incomplete KYC when enforcement is on', async () => {
    config.get.mockReturnValue(true);
    prisma.customerProfile.findFirst.mockResolvedValue({
      metadata: { kyc: { status: 'NOT_SUBMITTED' } },
      organization: { verificationStatus: 'PENDING' },
    });
    const guard = new CustomerKycApprovedGuard(config as never, prisma as never);
    await expect(guard.canActivate(context('u1'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows APPROVED KYC when enforcement is on', async () => {
    config.get.mockReturnValue(true);
    prisma.customerProfile.findFirst.mockResolvedValue({
      metadata: { kyc: { status: 'APPROVED' } },
      organization: { verificationStatus: 'APPROVED' },
    });
    const guard = new CustomerKycApprovedGuard(config as never, prisma as never);
    await expect(guard.canActivate(context('u1'))).resolves.toBe(true);
  });
});
