import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DocumentCategory,
  DocumentStatus,
  KycVerificationStatus,
  KycVerificationType,
  SellerOnboardingStatus,
  SellerStatus,
  VerificationStatus,
} from '../../../generated/prisma/client.js';
import { DocumentStateService } from '../../documents/common/document-state.service.js';
import { CUSTOMER_KYC_DOCUMENT_PURPOSE } from '../../customers/kyc/customer-kyc.slots.js';
import { SELLER_ONBOARDING_DOCUMENT_PURPOSE } from '../../sellers/onboarding/onboarding-documents.slots.js';
import { AdminKycService } from './admin-kyc.service.js';

const user = {
  firstName: 'Karan',
  lastName: 'Veer',
  displayName: null,
  phone: '+919999999999',
  email: 'karan@example.com',
};

function organization(overrides: Record<string, unknown> = {}) {
  return {
    id: 'org-1',
    name: 'Karan Veer Industries',
    legalName: 'Karan Veer Industries Pvt Ltd',
    gstin: null,
    pan: null,
    verificationStatus: VerificationStatus.PENDING,
    ...overrides,
  };
}

function kycDoc(
  slot: string,
  overrides: Record<string, unknown> = {},
  purpose = CUSTOMER_KYC_DOCUMENT_PURPOSE,
) {
  return {
    id: `doc-${slot}`,
    ownerId: 'cust-1',
    category: DocumentCategory.PAN,
    fileName: `${slot}.pdf`,
    originalFileName: `${slot}.pdf`,
    mimeType: 'application/pdf',
    fileSizeBytes: BigInt(1000),
    status: DocumentStatus.UNDER_REVIEW,
    metadata: {
      purpose,
      slot,
      r2Confirmed: true,
      uploadSource: 'CUSTOMER_WEB',
    },
    rejectionReason: null,
    verificationNotes: null,
    approvedAt: null,
    rejectedAt: null,
    createdAt: new Date('2026-09-27T10:00:00.000Z'),
    ...overrides,
  };
}

function customer(kyc: Record<string, unknown> = { status: 'SUBMITTED' }) {
  return {
    id: 'cust-1',
    userId: 'user-1',
    organizationId: 'org-1',
    status: 'ACTIVE',
    metadata: { kyc },
    createdAt: new Date('2026-09-20T00:00:00.000Z'),
    updatedAt: new Date('2026-09-27T00:00:00.000Z'),
    user,
    organization: organization(),
  };
}

function verificationRow(
  type: KycVerificationType,
  status: KycVerificationStatus,
) {
  return {
    id: `ver-${type}`,
    type,
    status,
    identifierMasked: 'masked',
    provider: 'manual',
    result: null,
    failureCode: null,
    failureReason: null,
    verifiedAt: null,
    reviewedAt: null,
    createdAt: new Date('2026-09-27T09:00:00.000Z'),
  };
}

describe('AdminKycService', () => {
  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    sellerProfile: { findMany: vi.fn(), findFirst: vi.fn() },
    customerProfile: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    document: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    organization: { update: vi.fn() },
    bankAccount: { findMany: vi.fn() },
    kycVerification: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { findMany: vi.fn() },
  };
  const storage = { getSignedDownloadUrl: vi.fn() };
  const audit = { log: vi.fn() };
  const notifications = { create: vi.fn() };
  const sellers = {
    approve: vi.fn(),
    reject: vi.fn(),
    requestChanges: vi.fn(),
  };
  let service: AdminKycService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    prisma.bankAccount.findMany.mockResolvedValue([]);
    prisma.document.findMany.mockResolvedValue([]);
    prisma.sellerProfile.findMany.mockResolvedValue([]);
    prisma.customerProfile.findMany.mockResolvedValue([]);
    prisma.kycVerification.findFirst.mockResolvedValue(null);
    prisma.kycVerification.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([
      { metadata: { kyc: { status: 'SUBMITTED' } } },
    ]);
    service = new AdminKycService(
      prisma as never,
      audit as never,
      notifications as never,
      new DocumentStateService(),
      sellers as never,
      storage as never,
    );
  });

  it('approves and confirms manual-review verifications as the reviewer', async () => {
    prisma.customerProfile.findFirst.mockResolvedValue(customer());
    prisma.document.findMany.mockResolvedValue([
      kycDoc('pan'),
      kycDoc('gst'),
      kycDoc('aadhaar'),
    ]);
    prisma.kycVerification.findFirst.mockImplementation(
      async (args: { where: { type: KycVerificationType } }) =>
        verificationRow(
          args.where.type,
          args.where.type === KycVerificationType.GST
            ? KycVerificationStatus.MANUAL_REVIEW
            : KycVerificationStatus.VERIFIED,
        ),
    );
    const detail = vi.spyOn(service, 'detail').mockResolvedValue({} as never);

    await service.approve('CUSTOMER', 'cust-1', 'admin-1', {});

    expect(prisma.kycVerification.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['ver-GST'] },
        status: KycVerificationStatus.MANUAL_REVIEW,
      },
      data: expect.objectContaining({
        status: KycVerificationStatus.VERIFIED,
        reviewedById: 'admin-1',
      }),
    });
    const metadata = prisma.customerProfile.update.mock.calls[0][0].data
      .metadata as { kyc: Record<string, unknown> };
    expect(metadata.kyc.status).toBe('APPROVED');
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ type: 'KYC_APPROVED' }),
      }),
    );
    expect(detail).toHaveBeenCalled();
  });

  it('blocks approval while a PAN or GST verification has failed', async () => {
    prisma.customerProfile.findFirst.mockResolvedValue(customer());
    prisma.document.findMany.mockResolvedValue([
      kycDoc('pan'),
      kycDoc('gst'),
      kycDoc('aadhaar'),
    ]);
    prisma.kycVerification.findFirst.mockImplementation(
      async (args: { where: { type: KycVerificationType } }) =>
        verificationRow(
          args.where.type,
          args.where.type === KycVerificationType.PAN
            ? KycVerificationStatus.FAILED
            : KycVerificationStatus.VERIFIED,
        ),
    );

    await expect(
      service.approve('CUSTOMER', 'cust-1', 'admin-1', {}),
    ).rejects.toThrow(/PAN verification failed/);
    expect(prisma.customerProfile.update).not.toHaveBeenCalled();
  });

  it('refuses to approve KYC that was not submitted for review', async () => {
    prisma.customerProfile.findFirst.mockResolvedValue(
      customer({ status: 'CHANGES_REQUESTED' }),
    );
    await expect(
      service.approve('CUSTOMER', 'cust-1', 'admin-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports a conflict when another reviewer acted first', async () => {
    prisma.customerProfile.findFirst.mockResolvedValue(customer());
    prisma.document.findMany.mockResolvedValue([
      kycDoc('pan'),
      kycDoc('gst'),
      kycDoc('aadhaar'),
    ]);
    prisma.$queryRaw.mockResolvedValue([
      { metadata: { kyc: { status: 'REJECTED' } } },
    ]);

    await expect(
      service.approve('CUSTOMER', 'cust-1', 'admin-1', {}),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.customerProfile.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('returns an audit trail with only whitelisted, non-sensitive details', async () => {
    prisma.customerProfile.findFirst.mockResolvedValue(customer());
    prisma.document.findMany.mockResolvedValue([{ id: 'doc-pan' }]);
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        action: 'CUSTOMER_KYC_PAN_VERIFIED',
        actorUserId: 'user-1',
        entityType: 'CUSTOMER',
        entityId: 'cust-1',
        metadata: { identifier: 'AA•••••39F', actorRole: 'CUSTOMER' },
        previousData: null,
        newData: { status: 'VERIFIED', pan: 'AAPFU0939F', storageKey: 'k' },
        createdAt: new Date('2026-09-27T10:00:00.000Z'),
        actor: { ...user, displayName: null },
      },
      {
        id: 'log-2',
        action: 'CUSTOMER_KYC_REJECTED',
        actorUserId: 'admin-9',
        entityType: 'CUSTOMER',
        entityId: 'cust-1',
        metadata: { actorRole: 'ADMIN' },
        previousData: { kycStatus: 'SUBMITTED' },
        newData: { kycStatus: 'REJECTED', reason: 'Expired GST' },
        createdAt: new Date('2026-09-27T11:00:00.000Z'),
        actor: null,
      },
    ]);

    const trail = await service.auditTrail('CUSTOMER', 'cust-1');

    expect(trail[0].actor.role).toBe('CUSTOMER');
    expect(trail[0].details).toEqual(
      expect.objectContaining({ identifier: 'AA•••••39F', status: 'VERIFIED' }),
    );
    expect(JSON.stringify(trail)).not.toContain('AAPFU0939F');
    expect(JSON.stringify(trail)).not.toContain('storageKey');
    expect(trail[1].actor.role).toBe('ADMIN');
    expect(trail[1].details).toEqual(
      expect.objectContaining({ reason: 'Expired GST', kycStatus: 'REJECTED' }),
    );
  });

  it('sends customer KYC back with the selected documents rejected', async () => {
    const current = customer();
    prisma.customerProfile.findFirst.mockResolvedValue(current);
    prisma.document.findMany.mockResolvedValue([
      kycDoc('pan'),
      kycDoc('gst', { status: DocumentStatus.VERIFIED }),
    ]);

    await service.requestChanges('CUSTOMER', 'cust-1', 'admin-1', {
      reason: 'PAN copy is blurred',
      documentIds: ['doc-pan'],
    });

    expect(prisma.document.update).toHaveBeenCalledTimes(1);
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-pan' },
        data: expect.objectContaining({
          status: DocumentStatus.REJECTED,
          rejectionReason: 'PAN copy is blurred',
        }),
      }),
    );
    const metadata = prisma.customerProfile.update.mock.calls[0][0].data
      .metadata as { kyc: Record<string, unknown> };
    expect(metadata.kyc.status).toBe('CHANGES_REQUESTED');
    expect(metadata.kyc.changeRequest).toEqual(
      expect.objectContaining({
        reason: 'PAN copy is blurred',
        slots: ['pan'],
        documentIds: ['doc-pan'],
        resolvedAt: null,
      }),
    );
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { verificationStatus: VerificationStatus.PENDING },
    });
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        metadata: expect.objectContaining({ type: 'KYC_CHANGES_REQUESTED' }),
      }),
    );
  });

  it('refuses to send back a document that is already verified', async () => {
    prisma.customerProfile.findFirst.mockResolvedValue(customer());
    prisma.document.findMany.mockResolvedValue([
      kycDoc('gst', { status: DocumentStatus.VERIFIED }),
    ]);

    await expect(
      service.requestChanges('CUSTOMER', 'cust-1', 'admin-1', {
        reason: 'Re-upload GST',
        documentIds: ['doc-gst'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customerProfile.update).not.toHaveBeenCalled();
  });

  it('blocks customer approval while a required document is missing', async () => {
    prisma.customerProfile.findFirst.mockResolvedValue(customer());
    prisma.document.findMany.mockResolvedValue([kycDoc('pan')]);

    await expect(
      service.approve('CUSTOMER', 'cust-1', 'admin-1', {}),
    ).rejects.toThrow(/GST Certificate \(missing\)/);
  });

  it('delegates seller actions to the seller review service', async () => {
    prisma.sellerProfile.findFirst.mockResolvedValue(null);
    sellers.requestChanges.mockResolvedValue({});

    await expect(
      service.requestChanges('SELLER', 'seller-1', 'admin-1', {
        reason: 'Upload a clearer cheque',
        documentIds: [],
      }),
    ).rejects.toThrow('Seller not found');
    expect(sellers.requestChanges).toHaveBeenCalledWith(
      'seller-1',
      'admin-1',
      expect.objectContaining({ reason: 'Upload a clearer cheque' }),
    );
  });

  it('derives queue status from onboarding and change requests', async () => {
    const baseSeller = {
      userId: 'user-s',
      organizationId: 'org-s',
      createdAt: new Date('2026-09-20T00:00:00.000Z'),
      updatedAt: new Date('2026-09-26T00:00:00.000Z'),
      user,
      organization: organization({ id: 'org-s', name: 'Karan Veer Trading' }),
    };
    const onboarding = (status: SellerOnboardingStatus) => ({
      status,
      submittedAt: new Date('2026-09-25T00:00:00.000Z'),
      reviewedAt: null,
      reviewNotes: null,
      rejectedReason: null,
      companyData: {},
      gstData: { gstin: '27AAPFU0939F1ZV' },
      panData: { pan: 'AAPFU0939F' },
      bankData: { accountNumber: '123456789012', ifsc: 'HDFC0001234' },
      addressData: {},
      updatedAt: new Date('2026-09-26T00:00:00.000Z'),
    });
    prisma.sellerProfile.findMany.mockResolvedValue([
      {
        ...baseSeller,
        id: 'seller-review',
        status: SellerStatus.UNDER_REVIEW,
        onboarding: onboarding(SellerOnboardingStatus.SUBMITTED),
        verification: null,
      },
      {
        ...baseSeller,
        id: 'seller-changes',
        status: SellerStatus.PENDING_VERIFICATION,
        onboarding: onboarding(SellerOnboardingStatus.IN_PROGRESS),
        verification: {
          overallStatus: VerificationStatus.PENDING,
          reviewedAt: null,
          metadata: {
            changeRequest: {
              reason: 'Upload clearer PAN',
              documentIds: [],
              slots: ['pan'],
              requestedAt: '2026-09-26T00:00:00.000Z',
              requestedById: 'admin-1',
              resolvedAt: null,
            },
          },
        },
      },
    ]);
    prisma.customerProfile.findMany.mockResolvedValue([customer()]);
    prisma.document.findMany.mockImplementation(
      async (args: { where: { ownerType: string } }) =>
        args.where.ownerType === 'SELLER'
          ? [
              {
                ...kycDoc('gst', {}, SELLER_ONBOARDING_DOCUMENT_PURPOSE),
                ownerId: 'seller-review',
              },
            ]
          : [],
    );

    const { items } = await service.list({ page: 1, limit: 20 });
    const byId = new Map(items.map((row) => [row.entityId, row]));
    expect(byId.get('seller-review')?.kycStatus).toBe('UNDER_REVIEW');
    expect(byId.get('seller-review')?.organization.gstin).toBe(
      '27AAPFU0939F1ZV',
    );
    expect(byId.get('seller-review')?.bank?.accountLast4).toBe('9012');
    expect(byId.get('seller-review')?.documents.uploaded).toBe(1);
    expect(byId.get('seller-changes')?.kycStatus).toBe('CHANGES_REQUESTED');
    expect(byId.get('seller-changes')?.changeRequest?.slots).toEqual(['pan']);
    expect(byId.get('cust-1')?.kycStatus).toBe('UNDER_REVIEW');

    const filtered = await service.list({
      page: 1,
      limit: 20,
      status: 'CHANGES_REQUESTED',
    });
    expect(filtered.items.map((row) => row.entityId)).toEqual([
      'seller-changes',
    ]);
  });
});
