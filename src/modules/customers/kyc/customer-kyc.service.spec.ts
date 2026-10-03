import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DocumentCategory,
  DocumentStatus,
  EntityOwnerType,
  KycVerificationStatus,
  KycVerificationType,
  VerificationStatus,
} from '../../../generated/prisma/client.js';
import { DocumentStateService } from '../../documents/common/document-state.service.js';
import { CustomerKycService } from './customer-kyc.service.js';
import { CUSTOMER_KYC_DOCUMENT_PURPOSE } from './customer-kyc.slots.js';
import { hashIdentifier } from './verification/kyc-identifiers.js';

const ctx = {
  userId: 'user-1',
  customerProfileId: 'cust-1',
  organizationId: 'org-1',
  status: 'ACTIVE',
  organizationName: 'Customer Organization',
};

const PAN = 'AAPFU0939F';
const GSTIN = '27AAPFU0939F1ZV';

const CATEGORY_BY_SLOT: Record<string, DocumentCategory> = {
  pan: DocumentCategory.PAN,
  gst: DocumentCategory.GST,
  aadhaar: DocumentCategory.AADHAAR,
  cancelledCheque: DocumentCategory.BANK,
};

function doc(slot: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `doc-${slot}`,
    organizationId: ctx.organizationId,
    ownerType: EntityOwnerType.CUSTOMER,
    ownerId: ctx.customerProfileId,
    category: CATEGORY_BY_SLOT[slot],
    fileName: `${slot}.pdf`,
    originalFileName: `${slot}.pdf`,
    mimeType: 'application/pdf',
    fileSizeBytes: BigInt(2048),
    storageKey: `customers/cust-1/${slot}.pdf`,
    status: DocumentStatus.UNDER_REVIEW,
    version: 1,
    rootDocumentId: null,
    deletedAt: null,
    rejectionReason: null,
    createdAt: new Date('2026-09-27T00:00:00.000Z'),
    metadata: {
      purpose: CUSTOMER_KYC_DOCUMENT_PURPOSE,
      slot,
      r2Confirmed: true,
    },
    ...overrides,
  };
}

function verification(
  type: KycVerificationType,
  identifier: string,
  status: KycVerificationStatus = KycVerificationStatus.VERIFIED,
  result: Record<string, unknown> = {},
) {
  return {
    id: `ver-${type}`,
    organizationId: ctx.organizationId,
    ownerType: EntityOwnerType.CUSTOMER,
    ownerId: ctx.customerProfileId,
    type,
    status,
    identifierHash: hashIdentifier(
      type === KycVerificationType.PAN ? 'PAN' : 'GST',
      identifier,
    ),
    identifierMasked: 'masked',
    provider: 'http',
    result,
    failureCode: null,
    failureReason: status === KycVerificationStatus.FAILED ? 'Not found' : null,
    requestedById: ctx.userId,
    verifiedAt: new Date(),
    reviewedById: null,
    reviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('CustomerKycService', () => {
  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    customerProfile: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    organization: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    document: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    kycVerification: { findFirst: vi.fn() },
  };
  const customerContext = {
    getOrCreateCustomer: vi.fn(),
    requireCustomer: vi.fn(),
  };
  const documents = { create: vi.fn(), requireDocument: vi.fn() };
  const storage = {
    getMaxDocumentSizeBytes: vi.fn(() => 10 * 1024 * 1024),
    assertConfigured: vi.fn(),
    exists: vi.fn(async () => true),
    isConfigured: vi.fn(() => true),
    delete: vi.fn(),
  };
  const audit = { log: vi.fn() };
  const notifications = { create: vi.fn() };
  let service: CustomerKycService;
  let stored: ReturnType<typeof doc>[];
  let profileMetadata: Record<string, unknown>;
  let lockedMetadata: Record<string, unknown> | null;
  let verifications: Partial<
    Record<KycVerificationType, ReturnType<typeof verification>>
  >;
  let orgGstin: string | null;

  beforeEach(() => {
    vi.clearAllMocks();
    stored = [];
    profileMetadata = {};
    lockedMetadata = null;
    verifications = {};
    orgGstin = null;
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    prisma.$queryRaw.mockImplementation(async () => [
      { metadata: lockedMetadata ?? profileMetadata },
    ]);
    customerContext.getOrCreateCustomer.mockResolvedValue(ctx);
    customerContext.requireCustomer.mockResolvedValue(ctx);
    prisma.customerProfile.findUnique.mockImplementation(async () => ({
      metadata: profileMetadata,
    }));
    prisma.customerProfile.findUniqueOrThrow.mockImplementation(async () => ({
      metadata: profileMetadata,
    }));
    prisma.organization.findUniqueOrThrow.mockImplementation(async () => ({
      name: 'Customer Organization',
      legalName: null,
      gstin: orgGstin,
      pan: null,
      verificationStatus: VerificationStatus.PENDING,
    }));
    prisma.document.findMany.mockImplementation(
      async (args: { where: { category: DocumentCategory } }) =>
        stored.filter((row) => row.category === args.where.category),
    );
    prisma.document.findFirst.mockResolvedValue(null);
    prisma.kycVerification.findFirst.mockImplementation(
      async (args: { where: { type: KycVerificationType } }) =>
        verifications[args.where.type] ?? null,
    );
    service = new CustomerKycService(
      prisma as never,
      customerContext as never,
      documents as never,
      storage as never,
      new DocumentStateService(),
      audit as never,
      notifications as never,
    );
  });

  function verifyBoth(result: Record<string, unknown> = {}) {
    verifications = {
      PAN: verification(KycVerificationType.PAN, PAN),
      GST: verification(
        KycVerificationType.GST,
        GSTIN,
        KycVerificationStatus.VERIFIED,
        result,
      ),
    };
    orgGstin = GSTIN;
  }

  it('lists verification and document steps that block submission', async () => {
    stored = [doc('pan')];
    const overview = await service.overview('user-1');
    expect(overview.status).toBe('NOT_SUBMITTED');
    expect(overview.canSubmit).toBe(false);
    expect(overview.missingRequired).toEqual([
      'PAN verification',
      'GST verification',
      'GST Certificate',
      'Aadhaar',
    ]);
    expect(overview.checklist.map((item) => item.state)).toEqual([
      'todo',
      'todo',
      'todo',
      'todo',
    ]);

    await expect(service.submit('user-1', {})).rejects.toThrow(
      /PAN verification, GST verification/,
    );
  });

  it('blocks submission while a verification has failed', async () => {
    stored = [doc('pan'), doc('gst'), doc('aadhaar')];
    verifyBoth();
    verifications.PAN = verification(
      KycVerificationType.PAN,
      PAN,
      KycVerificationStatus.FAILED,
    );
    const overview = await service.overview('user-1');
    expect(overview.checklist[0]).toMatchObject({
      key: 'pan',
      state: 'attention',
    });
    await expect(service.submit('user-1', {})).rejects.toThrow(
      /PAN verification \(failed\)/,
    );
  });

  it('blocks submission when the GSTIN belongs to a different PAN', async () => {
    stored = [doc('pan'), doc('gst'), doc('aadhaar')];
    verifyBoth();
    verifications.PAN = verification(KycVerificationType.PAN, 'ABCDE1234F');
    await expect(service.submit('user-1', {})).rejects.toThrow(
      /GSTIN must belong to the verified PAN/,
    );
  });

  it('accepts manual-review verifications so compliance can decide', async () => {
    stored = [doc('pan'), doc('gst'), doc('aadhaar')];
    verifyBoth();
    verifications.GST = verification(
      KycVerificationType.GST,
      GSTIN,
      KycVerificationStatus.MANUAL_REVIEW,
    );
    const overview = await service.overview('user-1');
    expect(overview.canSubmit).toBe(true);
    expect(overview.checklist[1]).toMatchObject({ state: 'pending' });
  });

  it('resubmits after changes were requested, using the GST-verified legal name', async () => {
    stored = [doc('pan'), doc('gst'), doc('aadhaar')];
    verifyBoth({ legalName: 'Karan Veer Industries Pvt Ltd' });
    profileMetadata = {
      kyc: {
        status: 'CHANGES_REQUESTED',
        changeRequest: {
          reason: 'Blurred PAN',
          documentIds: ['old-pan'],
          slots: ['pan'],
          requestedAt: '2026-09-26T00:00:00.000Z',
          requestedById: 'admin-1',
          resolvedAt: null,
        },
      },
    };

    await service.submit('user-1', { businessName: 'KV Polymers' });

    const metadata = prisma.customerProfile.update.mock.calls[0][0].data
      .metadata as { kyc: Record<string, unknown> };
    expect(metadata.kyc.status).toBe('SUBMITTED');
    expect(
      (metadata.kyc.changeRequest as { resolvedAt: string | null }).resolvedAt,
    ).toEqual(expect.any(String));
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: {
        verificationStatus: VerificationStatus.UNDER_REVIEW,
        name: 'KV Polymers',
        legalName: 'Karan Veer Industries Pvt Ltd',
      },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CUSTOMER_KYC_RESUBMITTED' }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        metadata: expect.objectContaining({ type: 'KYC_SUBMITTED' }),
      }),
    );
  });

  it('rejects a submitted PAN that differs from the verified one', async () => {
    stored = [doc('pan'), doc('gst'), doc('aadhaar')];
    verifyBoth();
    await expect(
      service.submit('user-1', { pan: 'ABCDE1234F' }),
    ).rejects.toThrow(/has not been verified/);
  });

  it('treats a repeated submit as a no-op', async () => {
    profileMetadata = { kyc: { status: 'SUBMITTED' } };
    const overview = await service.submit('user-1', {});
    expect(overview.status).toBe('SUBMITTED');
    expect(prisma.customerProfile.update).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('does not double-submit when another request wins the row lock', async () => {
    stored = [doc('pan'), doc('gst'), doc('aadhaar')];
    verifyBoth();
    lockedMetadata = { kyc: { status: 'SUBMITTED' } };
    await service.submit('user-1', {});
    expect(prisma.customerProfile.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('only allows re-uploading rejected slots while under review, chaining versions', async () => {
    profileMetadata = { kyc: { status: 'SUBMITTED' } };
    stored = [doc('pan')];
    const upload = {
      slot: 'pan' as const,
      fileName: 'pan.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1000,
    };

    await expect(service.createUpload('user-1', upload)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    stored = [doc('pan', { status: DocumentStatus.REJECTED })];
    prisma.document.findFirst.mockResolvedValue({
      id: 'doc-pan',
      version: 2,
      rootDocumentId: 'doc-pan-v1',
    });
    documents.create.mockResolvedValue({
      id: 'doc-new',
      fileName: 'pan.pdf',
      originalFileName: 'pan.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: '1000',
      status: DocumentStatus.UPLOADED,
      uploadUrl: 'https://r2.example/upload',
    });

    const created = await service.createUpload('user-1', {
      ...upload,
      source: 'CUSTOMER_APP',
    });
    expect(created.uploadUrl).toBe('https://r2.example/upload');
    expect(documents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerType: EntityOwnerType.CUSTOMER,
        metadata: expect.objectContaining({
          purpose: CUSTOMER_KYC_DOCUMENT_PURPOSE,
          slot: 'pan',
          uploadSource: 'CUSTOMER_APP',
        }),
      }),
    );
    expect(prisma.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-new' },
      data: {
        version: 3,
        rootDocumentId: 'doc-pan-v1',
        previousDocumentId: 'doc-pan',
      },
    });
  });

  it('keeps the stored file when removing a document from a previously submitted KYC', async () => {
    profileMetadata = { kyc: { status: 'REJECTED' } };
    const existing = doc('pan', { status: DocumentStatus.REJECTED });
    documents.requireDocument.mockResolvedValue(existing);
    await service.remove('user-1', existing.id);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: DocumentStatus.ARCHIVED }),
      }),
    );
  });
});
