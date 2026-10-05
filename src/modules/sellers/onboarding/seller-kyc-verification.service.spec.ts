import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KycVerificationStatus,
  KycVerificationType,
  SellerOnboardingStatus,
} from '../../../generated/prisma/client.js';
import { hashIdentifier } from '../../kyc-verification/kyc-identifiers.js';
import { SellerKycVerificationService } from './seller-kyc-verification.service.js';

const ctx = {
  userId: 'user-s',
  sellerProfileId: 'seller-1',
  organizationId: 'org-s',
  status: 'DRAFT',
  organizationName: 'Seller Org',
  verificationStatus: 'PENDING',
};

function row(
  type: KycVerificationType,
  identifier: string,
  status: KycVerificationStatus = KycVerificationStatus.VERIFIED,
  extra: Record<string, unknown> = {},
) {
  return {
    id: `ver-${type}`,
    type,
    status,
    identifierHash: hashIdentifier(
      type === KycVerificationType.PAN ? 'PAN' : 'GST',
      identifier,
    ),
    identifierMasked: 'masked',
    provider: 'surepass',
    providerReference: 'ref-1',
    source: 'SELLER_WEB',
    linkedPanHash: null,
    result:
      type === KycVerificationType.GST
        ? {
            legalName: 'KV Trading Pvt Ltd',
            state: 'Maharashtra',
            stateCode: '27',
          }
        : { nameOnPan: 'KARAN VEER' },
    failureCode: null,
    failureReason: null,
    reviewedById: null,
    verifiedAt: new Date(),
    reviewedAt: null,
    createdAt: new Date(),
    ...extra,
  };
}

describe('SellerKycVerificationService', () => {
  const prisma = {
    sellerProfile: { findFirst: vi.fn() },
    sellerManagerAssignment: { findFirst: vi.fn() },
    sellerOnboarding: {
      upsert: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    kycVerification: { findFirst: vi.fn() },
  };
  const sellerContext = { getOrCreateDraftSeller: vi.fn() };
  const verification = { verify: vi.fn() };
  let latest: Record<string, unknown>;
  let onboardingStatus: SellerOnboardingStatus;
  let service: SellerKycVerificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    latest = {};
    onboardingStatus = SellerOnboardingStatus.IN_PROGRESS;
    prisma.sellerProfile.findFirst.mockResolvedValue({ id: 'seller-1' });
    sellerContext.getOrCreateDraftSeller.mockResolvedValue(ctx);
    prisma.sellerOnboarding.upsert.mockImplementation(async () => ({
      id: 'onb-1',
      status: onboardingStatus,
      gstData: {},
      panData: {},
    }));
    prisma.sellerOnboarding.findUniqueOrThrow.mockResolvedValue({
      gstData: { gstin: '27AAPFU0939F1ZV', status: 'verified' },
      panData: {},
    });
    prisma.kycVerification.findFirst.mockImplementation(
      async (args: { where: { type: KycVerificationType } }) =>
        latest[args.where.type] ?? null,
    );
    service = new SellerKycVerificationService(
      prisma as never,
      sellerContext as never,
      verification as never,
    );
  });

  it('rejects malformed identifiers before calling the provider', async () => {
    await expect(service.verifyPan('user-s', 'ABC')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.verifyGst('user-s', '27AAPFU0939F1ZX'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(verification.verify).not.toHaveBeenCalled();
  });

  it('verifies against the seller resolved from the JWT and writes the PAN server-side', async () => {
    verification.verify.mockResolvedValue(
      row(KycVerificationType.PAN, 'AAPFU0939F'),
    );

    const result = await service.verifyPan('user-s', 'aapfu0939f', {
      source: 'SELLER_APP',
    });

    expect(verification.verify).toHaveBeenCalledWith(
      {
        ownerType: 'SELLER',
        ownerId: 'seller-1',
        organizationId: 'org-s',
        userId: 'user-s',
      },
      KycVerificationType.PAN,
      'AAPFU0939F',
      { source: 'SELLER_APP' },
    );
    expect(prisma.sellerOnboarding.update).toHaveBeenCalledWith({
      where: { id: 'onb-1' },
      data: { panData: { pan: 'AAPFU0939F', status: 'verified' } },
    });
    expect(result).toMatchObject({ status: 'VERIFIED', mismatch: false });
  });

  it('does not save an identifier the provider rejected', async () => {
    verification.verify.mockResolvedValue(
      row(
        KycVerificationType.GST,
        '27AAPFU0939F1ZV',
        KycVerificationStatus.FAILED,
      ),
    );
    const result = await service.verifyGst('user-s', '27AAPFU0939F1ZV');
    expect(result.status).toBe('FAILED');
    expect(prisma.sellerOnboarding.update).not.toHaveBeenCalled();
  });

  it('flags a GST/PAN mismatch', async () => {
    latest.PAN = row(KycVerificationType.PAN, 'ABCDE1234F');
    verification.verify.mockResolvedValue(
      row(
        KycVerificationType.GST,
        '27AAPFU0939F1ZV',
        KycVerificationStatus.VERIFIED,
        {
          linkedPanHash: hashIdentifier('PAN', 'AAPFU0939F'),
        },
      ),
    );
    const result = await service.verifyGst('user-s', '27AAPFU0939F1ZV');
    expect(result.mismatch).toBe(true);
    expect(result.warning).toMatch(/GST\/PAN mismatch/);
  });

  it('forbids Seller Managers from verifying the owner identifiers', async () => {
    prisma.sellerProfile.findFirst.mockResolvedValue(null);
    prisma.sellerManagerAssignment.findFirst.mockResolvedValue({
      sellerProfile: { id: 'seller-1', deletedAt: null },
    });
    await expect(
      service.verifyPan('manager-1', 'AAPFU0939F'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(verification.verify).not.toHaveBeenCalled();
  });

  it('locks verification after submission', async () => {
    onboardingStatus = SellerOnboardingStatus.SUBMITTED;
    await expect(service.verifyPan('user-s', 'AAPFU0939F')).rejects.toThrow(
      /under review/,
    );
    expect(verification.verify).not.toHaveBeenCalled();
  });

  it('ignores client-asserted verification flags', async () => {
    const result = await service.withServerVerificationFields('seller-1', {
      gstData: {
        gstin: '27AAPFU0939F1ZV',
        status: 'verified',
        gstStatus: 'ACTIVE',
      },
      panData: { pan: 'AAPFU0939F', status: 'verified', panStatus: 'VALID' },
    });
    expect(result.gstData).toEqual({
      gstin: '27AAPFU0939F1ZV',
      status: 'pending',
    });
    expect(result.panData).toEqual({ pan: 'AAPFU0939F', status: 'pending' });

    latest.PAN = row(KycVerificationType.PAN, 'AAPFU0939F');
    const verified = await service.withServerVerificationFields('seller-1', {
      panData: { pan: 'AAPFU0939F' },
    });
    expect(verified.panData).toEqual({ pan: 'AAPFU0939F', status: 'verified' });
  });

  it('blocks submission when the saved identifier differs from the verified one', async () => {
    latest.PAN = row(KycVerificationType.PAN, 'AAPFU0939F');
    latest.GST = row(KycVerificationType.GST, '27AAPFU0939F1ZV');

    const ok = await service.summary('seller-1', {
      panData: { pan: 'AAPFU0939F' },
      gstData: { gstin: '27AAPFU0939F1ZV' },
    });
    expect(ok.blockers).toEqual([]);

    const edited = await service.summary('seller-1', {
      panData: { pan: 'ABCDE1234F' },
      gstData: { gstin: '27AAPFU0939F1ZV' },
    });
    expect(edited.blockers).toEqual(['PAN verification']);
  });
});
