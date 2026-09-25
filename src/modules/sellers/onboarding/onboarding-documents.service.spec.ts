import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DocumentCategory,
  DocumentStatus,
  EntityOwnerType,
  StorageProvider,
} from '../../../generated/prisma/client.js';
import { OnboardingDocumentsService } from './onboarding-documents.service.js';
import { SELLER_ONBOARDING_DOCUMENT_PURPOSE } from './onboarding-documents.slots.js';

const ctx = {
  userId: 'user-1',
  sellerProfileId: 'seller-1',
  organizationId: 'org-1',
  status: 'DRAFT',
  organizationName: 'Seller Organization',
  verificationStatus: 'PENDING',
};

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    organizationId: ctx.organizationId,
    uploadedById: ctx.userId,
    ownerType: EntityOwnerType.SELLER,
    ownerId: ctx.sellerProfileId,
    category: DocumentCategory.GST,
    fileName: 'gst.pdf',
    originalFileName: 'gst.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: BigInt(1200),
    storageProvider: StorageProvider.CLOUDFLARE_R2,
    storageKey: 'sellers/seller-1/gst/doc-1/gst.pdf',
    status: DocumentStatus.UPLOADED,
    deletedAt: null,
    rejectionReason: null,
    createdAt: new Date('2026-09-24T00:00:00.000Z'),
    metadata: {
      purpose: SELLER_ONBOARDING_DOCUMENT_PURPOSE,
      slot: 'gst',
      r2Confirmed: false,
    },
    ...overrides,
  };
}

describe('OnboardingDocumentsService', () => {
  const prisma = {
    document: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    sellerOnboarding: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  const sellerContext = {
    getOrCreateDraftSeller: vi.fn(),
    requireSeller: vi.fn(),
  };
  const documents = {
    create: vi.fn(),
    requireDocument: vi.fn(),
    download: vi.fn(),
  };
  const storage = {
    getMaxDocumentSizeBytes: vi.fn(() => 10 * 1024 * 1024),
    assertConfigured: vi.fn(),
    exists: vi.fn(),
    isConfigured: vi.fn(() => true),
    delete: vi.fn(),
  };
  const state = {
    assertTransition: vi.fn(),
  };
  const audit = { log: vi.fn() };

  let service: OnboardingDocumentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    sellerContext.getOrCreateDraftSeller.mockResolvedValue(ctx);
    sellerContext.requireSeller.mockResolvedValue(ctx);
    prisma.document.findMany.mockResolvedValue([]);
    prisma.sellerOnboarding.findUnique.mockResolvedValue({
      id: 'onb-1',
      status: 'DRAFT',
      metadata: {},
    });
    prisma.sellerOnboarding.update.mockResolvedValue({});
    service = new OnboardingDocumentsService(
      prisma as never,
      sellerContext as never,
      documents as never,
      storage as never,
      state as never,
      audit as never,
    );
  });

  it('lists the four required slots when nothing is stored', async () => {
    const result = await service.list('user-1');
    expect(result.slots.map((slot) => slot.slot)).toEqual([
      'gst',
      'pan',
      'aadhaar',
      'cancelledCheque',
    ]);
    expect(result.slots.every((slot) => slot.required && slot.document === null)).toBe(
      true,
    );
  });

  it('refuses to confirm when the object is not in R2', async () => {
    documents.requireDocument.mockResolvedValue(doc());
    storage.exists.mockResolvedValue(false);

    await expect(service.confirm('user-1', 'doc-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('marks the document under review after the R2 object exists', async () => {
    const pending = doc();
    documents.requireDocument.mockResolvedValue(pending);
    storage.exists.mockResolvedValue(true);
    const stored = doc({
      status: DocumentStatus.UNDER_REVIEW,
      metadata: {
        purpose: SELLER_ONBOARDING_DOCUMENT_PURPOSE,
        slot: 'gst',
        r2Confirmed: true,
      },
    });
    prisma.document.update.mockResolvedValue(stored);
    prisma.document.findMany.mockResolvedValue([stored]);

    const result = await service.confirm('user-1', 'doc-1');

    expect(result.r2Confirmed).toBe(true);
    expect(result.status).toBe(DocumentStatus.UNDER_REVIEW);
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-1' },
        data: expect.objectContaining({ status: DocumentStatus.UNDER_REVIEW }),
      }),
    );
    expect(prisma.sellerOnboarding.update).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SELLER_ONBOARDING_DOCUMENT_STORED' }),
    );
  });

  it('reports required documents that are not confirmed in storage', async () => {
    prisma.document.findMany.mockImplementation(
      async ({ where }: { where: { category: DocumentCategory } }) => {
        if (where.category !== DocumentCategory.GST) return [];
        return [
          doc({
            status: DocumentStatus.UNDER_REVIEW,
            metadata: {
              purpose: SELLER_ONBOARDING_DOCUMENT_PURPOSE,
              slot: 'gst',
              r2Confirmed: true,
            },
          }),
        ];
      },
    );
    storage.exists.mockResolvedValue(true);

    const missing = await service.missingRequiredLabels('user-1');
    expect(missing).toEqual(['PAN Card', 'Aadhaar', 'Cancelled Cheque']);
  });
});
