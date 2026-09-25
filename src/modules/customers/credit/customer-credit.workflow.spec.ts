import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CreditApplicationStatus,
  DocumentCategory,
  DocumentStatus,
  EntityOwnerType,
} from '../../../generated/prisma/client.js';
import { AdminCreditService } from '../../admin/credit/admin-credit.service.js';
import { formatCreditApplicationNumber } from '../../payments/common/credit-number.js';
import { CustomerCreditService } from './customer-credit.service.js';

const ctx = {
  userId: 'user-1',
  customerProfileId: 'cust-1',
  organizationId: 'org-1',
  status: 'ACTIVE',
  organizationName: 'Acme Fuels',
};

const customerProfile = {
  id: 'cust-1',
  userId: 'user-1',
  organizationId: 'org-1',
  creditStatus: 'PENDING',
  status: 'ACTIVE',
  notes: null,
  user: {
    id: 'user-1',
    email: 'buyer@acme.test',
    phone: null,
    firstName: 'Ada',
    lastName: 'Buyer',
    displayName: null,
  },
  organization: {
    id: 'org-1',
    name: 'Acme Fuels',
    legalName: 'Acme Fuels Pvt Ltd',
    code: 'ACME',
    businessType: null,
    gstin: null,
    pan: null,
    email: null,
    phone: null,
    verificationStatus: 'VERIFIED',
  },
};

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    applicationNumber: 'CR-202609-000123',
    customerProfileId: 'cust-1',
    creditProfileId: null,
    status: CreditApplicationStatus.DRAFT,
    requestedLimit: '2500000',
    requestedTenureDays: 30,
    purpose: 'Diesel procurement',
    currency: 'INR',
    assignedAdminId: null,
    decidedAt: null,
    decisionReason: null,
    approvedLimit: null,
    approvedTenureDays: null,
    submittedAt: null,
    effectiveAt: null,
    expiresAt: null,
    customerMessage: null,
    insuranceStatus: 'NOT_STARTED',
    arrangementStatus: 'NOT_STARTED',
    insurancePartner: null,
    insuranceReference: null,
    insuredAmount: null,
    notes: null,
    metadata: null,
    createdAt: new Date('2026-09-25T00:00:00.000Z'),
    updatedAt: new Date('2026-09-25T00:00:00.000Z'),
    customerProfile,
    ...overrides,
  };
}

function creditDocument(documentType: string, category: DocumentCategory) {
  return {
    id: `doc-${documentType}`,
    documentNumber: `DOC-${documentType}`,
    category,
    fileName: `${documentType}.pdf`,
    mimeType: 'application/pdf',
    fileSizeBytes: BigInt(2048),
    status: DocumentStatus.UPLOADED,
    version: 1,
    rejectionReason: null,
    storageProvider: 'CLOUDFLARE_R2',
    ownerType: EntityOwnerType.CREDIT,
    ownerId: 'app-1',
    deletedAt: null,
    metadata: { documentType, creditApplicationId: 'app-1' },
    createdAt: new Date('2026-09-25T01:00:00.000Z'),
    updatedAt: new Date('2026-09-25T01:00:00.000Z'),
  };
}

const ALL_REQUIRED_DOCUMENTS = [
  creditDocument('gst_registration', DocumentCategory.GST),
  creditDocument('bank_statement', DocumentCategory.BANK),
  creditDocument('itr_financials', DocumentCategory.FINANCIAL_STATEMENT),
];

describe('credit application numbering', () => {
  it('formats as CR-YYYYMM-XXXXXX', () => {
    expect(
      formatCreditApplicationNumber(new Date('2026-03-04T00:00:00Z')),
    ).toMatch(/^CR-202603-\d{6}$/);
  });
});

describe('CustomerCreditService credit request workflow', () => {
  const prisma = {
    creditApplication: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    customerCreditProfile: { findUnique: vi.fn(), upsert: vi.fn() },
    customerProfile: { update: vi.fn() },
    document: { findMany: vi.fn() },
    userRole: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const context = { requireCustomer: vi.fn() };
  const audit = { log: vi.fn() };
  const notifications = { create: vi.fn() };
  const eligibility = { inspect: vi.fn() };
  const documents = {
    create: vi.fn(),
    replace: vi.fn(),
    requireDocument: vi.fn(),
    download: vi.fn(),
    getUploadUrl: vi.fn(),
  };
  const timeline = { record: vi.fn(), list: vi.fn() };
  const storage = { isConfigured: vi.fn(() => true) };

  let service: CustomerCreditService;

  beforeEach(() => {
    vi.clearAllMocks();
    context.requireCustomer.mockResolvedValue(ctx);
    prisma.creditApplication.findFirst.mockResolvedValue(null);
    prisma.customerCreditProfile.findUnique.mockResolvedValue(null);
    prisma.document.findMany.mockResolvedValue([]);
    prisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-1' }]);
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          creditApplication: prisma.creditApplication,
          customerProfile: prisma.customerProfile,
          customerCreditProfile: prisma.customerCreditProfile,
        }),
    );
    timeline.list.mockResolvedValue([]);
    storage.isConfigured.mockReturnValue(true);
    service = new CustomerCreditService(
      prisma as never,
      context as never,
      audit as never,
      notifications as never,
      eligibility as never,
      documents as never,
      timeline as never,
      storage as never,
    );
  });

  it('blocks a second application while one is still open', async () => {
    prisma.creditApplication.findFirst.mockResolvedValue(
      application({ status: CreditApplicationStatus.UNDER_REVIEW }),
    );

    await expect(
      service.apply('user-1', { requestedLimit: 1000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.saveDraft('user-1', { requestedLimit: 1000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.creditApplication.create).not.toHaveBeenCalled();
  });

  it('reuses the open draft instead of creating a second one', async () => {
    prisma.creditApplication.findFirst.mockResolvedValue(application());
    prisma.creditApplication.update.mockResolvedValue(
      application({ requestedLimit: '3000000' }),
    );

    const result = await service.saveDraft('user-1', {
      requestedLimit: 3000000,
    });

    expect(prisma.creditApplication.create).not.toHaveBeenCalled();
    expect(prisma.creditApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'app-1' } }),
    );
    expect(result.status).toBe(CreditApplicationStatus.DRAFT);
  });

  it('refuses to submit until the required documents are attached', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(application());
    prisma.document.findMany.mockResolvedValue([
      creditDocument('gst_registration', DocumentCategory.GST),
    ]);

    await expect(service.submit('user-1', 'app-1')).rejects.toThrow(
      /Bank Statement/,
    );
    expect(prisma.creditApplication.update).not.toHaveBeenCalled();
  });

  it('submits once every required document is attached', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(application());
    prisma.document.findMany.mockResolvedValue(ALL_REQUIRED_DOCUMENTS);
    prisma.creditApplication.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) =>
        application({ ...data }),
    );

    const result = await service.submit('user-1', 'app-1');

    expect(result.status).toBe(CreditApplicationStatus.PENDING);
    expect(result.submittedAt).toBeInstanceOf(Date);
    expect(timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CREDIT_APPLICATION_SUBMITTED',
        customerVisible: true,
      }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1' }),
    );
  });

  it('rejects submitting an application that is already under review', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: CreditApplicationStatus.UNDER_REVIEW }),
    );

    await expect(service.submit('user-1', 'app-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('only allows resubmitting documents from DOCUMENTS_REQUIRED', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: CreditApplicationStatus.PENDING }),
    );
    await expect(
      service.resubmitDocuments('user-1', 'app-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: CreditApplicationStatus.DOCUMENTS_REQUIRED }),
    );
    prisma.creditApplication.update.mockResolvedValue(
      application({ status: CreditApplicationStatus.DOCUMENTS_UNDER_REVIEW }),
    );

    const result = await service.resubmitDocuments('user-1', 'app-1', {});
    expect(result.status).toBe(CreditApplicationStatus.DOCUMENTS_UNDER_REVIEW);
  });

  it('never returns another customer application', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ customerProfileId: 'cust-other' }),
    );

    await expect(
      service.getApplication('user-1', 'app-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.listApplicationDocuments('user-1', 'app-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getTimeline('user-1', 'app-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('scopes document uploads to the owning application and keeps them customer-safe', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(application());
    documents.create.mockResolvedValue({
      id: 'doc-1',
      uploadUrl: 'https://r2',
    });

    await service.createApplicationDocument('user-1', 'app-1', {
      documentType: 'gst_registration',
      fileName: 'gst.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 2048,
    });

    expect(documents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerType: EntityOwnerType.CREDIT,
        ownerId: 'app-1',
        category: DocumentCategory.GST,
        metadata: expect.objectContaining({
          documentType: 'gst_registration',
        }),
      }),
    );
  });

  it('blocks document changes once the application is under review', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: CreditApplicationStatus.UNDER_REVIEW }),
    );

    await expect(
      service.createApplicationDocument('user-1', 'app-1', {
        documentType: 'gst_registration',
        fileName: 'gst.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 2048,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('omits internal fields from the customer application view', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({
        status: CreditApplicationStatus.REJECTED,
        notes: 'internal: weak balance sheet',
        decisionReason: 'internal: weak balance sheet',
        customerMessage: 'We could not approve credit at this time.',
        insurancePartner: 'Secret Partner Ltd',
      }),
    );

    const view = await service.getApplication('user-1', 'app-1');
    const serialized = JSON.stringify(view);

    expect(view.customerMessage).toBe(
      'We could not approve credit at this time.',
    );
    expect(serialized).not.toContain('internal:');
    expect(serialized).not.toContain('Secret Partner Ltd');
  });
});

describe('AdminCreditService credit decisions', () => {
  const prisma = {
    creditApplication: { findUnique: vi.fn(), update: vi.fn() },
    customerCreditProfile: { findUnique: vi.fn(), upsert: vi.fn() },
    customerProfile: { update: vi.fn() },
    document: { findMany: vi.fn(), findFirst: vi.fn() },
    auditLog: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const audit = { log: vi.fn() };
  const ledger = { recordTransaction: vi.fn(), refreshBalances: vi.fn() };
  const documents = { approve: vi.fn(), reject: vi.fn() };
  const notifications = { create: vi.fn() };
  const storage = { isConfigured: vi.fn(() => true) };
  const timeline = { record: vi.fn(), list: vi.fn() };

  let service: AdminCreditService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.document.findMany.mockResolvedValue([]);
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.customerCreditProfile.findUnique.mockResolvedValue(null);
    prisma.customerCreditProfile.upsert.mockResolvedValue({
      id: 'credit-1',
    });
    prisma.creditApplication.update.mockResolvedValue(application());
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          creditApplication: prisma.creditApplication,
          customerProfile: prisma.customerProfile,
          customerCreditProfile: prisma.customerCreditProfile,
        }),
    );
    timeline.list.mockResolvedValue([]);
    service = new AdminCreditService(
      prisma as never,
      audit as never,
      ledger as never,
      documents as never,
      notifications as never,
      storage as never,
      timeline as never,
    );
  });

  it('approves and opens an account with the full approved limit available', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: CreditApplicationStatus.UNDER_REVIEW }),
    );

    await service.approve('app-1', 'admin-1', {
      approvedLimit: 1500000,
      creditTermDays: 45,
    });

    const upsert = prisma.customerCreditProfile.upsert.mock.calls[0][0];
    expect(upsert.update.approvedLimit.toFixed(2)).toBe('1500000.00');
    expect(upsert.update.availableLimit.toFixed(2)).toBe('1500000.00');
    expect(upsert.update.utilizedAmount).toBe(0);
    expect(prisma.creditApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CreditApplicationStatus.APPROVED,
          approvedTenureDays: 45,
        }),
      }),
    );
    expect(ledger.recordTransaction).toHaveBeenCalled();
    expect(ledger.refreshBalances).toHaveBeenCalledWith(
      expect.anything(),
      'credit-1',
    );
  });

  it('partially approves with an ACTIVE account but a PARTIALLY_APPROVED application', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: CreditApplicationStatus.UNDER_REVIEW }),
    );

    await service.partialApprove('app-1', 'admin-1', {
      approvedLimit: 500000,
    });

    expect(prisma.creditApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CreditApplicationStatus.PARTIALLY_APPROVED,
        }),
      }),
    );
    const upsert = prisma.customerCreditProfile.upsert.mock.calls[0][0];
    expect(upsert.update.accountStatus).toBe('ACTIVE');
  });

  it('refuses to approve a zero limit or an already decided application', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: CreditApplicationStatus.UNDER_REVIEW }),
    );
    await expect(
      service.approve('app-1', 'admin-1', { approvedLimit: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: CreditApplicationStatus.APPROVED }),
    );
    await expect(
      service.approve('app-1', 'admin-1', { approvedLimit: 100000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a reason to reject', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: CreditApplicationStatus.UNDER_REVIEW }),
    );

    await expect(
      service.reject('app-1', 'admin-1', { reason: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.creditApplication.update).not.toHaveBeenCalled();
  });

  it('blocks starting a review from a decided application', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: CreditApplicationStatus.REJECTED }),
    );

    await expect(
      service.startReview('app-1', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a reason to reject a document', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: CreditApplicationStatus.UNDER_REVIEW }),
    );
    prisma.document.findFirst.mockResolvedValue({ id: 'doc-1' });

    await expect(
      service.rejectApplicationDocument('app-1', 'doc-1', 'admin-1', {
        reason: ' ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(documents.reject).not.toHaveBeenCalled();
  });
});
