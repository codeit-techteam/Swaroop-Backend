import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DocumentCategory,
  DocumentStatus,
  EntityOwnerType,
  VerificationStatus,
} from '../../../generated/prisma/client.js';
import { DocumentStateService } from '../../documents/common/document-state.service.js';
import { CustomerKycService } from './customer-kyc.service.js';
import { CUSTOMER_KYC_DOCUMENT_PURPOSE } from './customer-kyc.slots.js';

const ctx = {
  userId: 'user-1',
  customerProfileId: 'cust-1',
  organizationId: 'org-1',
  status: 'ACTIVE',
  organizationName: 'Customer Organization',
};

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

describe('CustomerKycService', () => {
  const prisma = {
    $transaction: vi.fn(),
    customerProfile: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    organization: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    document: { findMany: vi.fn(), update: vi.fn() },
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
  let service: CustomerKycService;
  let stored: ReturnType<typeof doc>[];
  let profileMetadata: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    stored = [];
    profileMetadata = {};
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    customerContext.getOrCreateCustomer.mockResolvedValue(ctx);
    customerContext.requireCustomer.mockResolvedValue(ctx);
    prisma.customerProfile.findUnique.mockImplementation(async () => ({
      metadata: profileMetadata,
    }));
    prisma.customerProfile.findUniqueOrThrow.mockImplementation(async () => ({
      metadata: profileMetadata,
    }));
    prisma.organization.findUniqueOrThrow.mockResolvedValue({
      name: 'Customer Organization',
      legalName: null,
      gstin: null,
      pan: null,
      verificationStatus: VerificationStatus.PENDING,
    });
    prisma.document.findMany.mockImplementation(
      async (args: { where: { category: DocumentCategory } }) =>
        stored.filter((row) => row.category === args.where.category),
    );
    service = new CustomerKycService(
      prisma as never,
      customerContext as never,
      documents as never,
      storage as never,
      new DocumentStateService(),
      audit as never,
    );
  });

  it('reports missing required slots and blocks submission', async () => {
    stored = [doc('pan')];
    const overview = await service.overview('user-1');
    expect(overview.status).toBe('NOT_SUBMITTED');
    expect(overview.canSubmit).toBe(false);
    expect(overview.missingRequired).toEqual(['GST Certificate', 'Aadhaar']);

    await expect(service.submit('user-1', {})).rejects.toThrow(
      /GST Certificate, Aadhaar/,
    );
  });

  it('resubmits after changes were requested and closes the request', async () => {
    stored = [doc('pan'), doc('gst'), doc('aadhaar')];
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

    await service.submit('user-1', { gstin: '27AAPFU0939F1ZV' });

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
        gstin: '27AAPFU0939F1ZV',
      },
    });
  });

  it('only allows re-uploading rejected slots while under review', async () => {
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
  });
});
