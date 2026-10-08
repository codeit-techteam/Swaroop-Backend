import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CreditApplicationSource,
  CreditApplicationStatus,
  DocumentCategory,
  DocumentStatus,
  EntityOwnerType,
} from '../../../generated/prisma/client.js';
import {
  originMatches,
  resolveClientSource,
  type ClientOriginConfig,
} from '../../../common/utils/client-source.js';
import {
  canTransitionCredit,
  creditAdminActions,
  creditDisplayStatus,
} from '../../payments/common/credit-workflow.js';
import { CustomerCreditService } from '../../customers/credit/customer-credit.service.js';
import { mapApplication } from './admin-credit.mapper.js';
import {
  AdminCreditService,
  applicationsOrderBy,
  buildApplicationsWhere,
  istPeriodStarts,
} from './admin-credit.service.js';

const ORIGINS: ClientOriginConfig = {
  website: [
    'https://swaroop-website.vercel.app',
    'https://swaroop-website-*.vercel.app',
  ],
  customerWeb: ['https://swaroop-customer-webapp.vercel.app'],
  sellerWeb: ['https://swaroop-seller-webapp.vercel.app'],
  adminWeb: ['https://swaroop-admin-pi.vercel.app'],
};

const S = CreditApplicationStatus;

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
    phone: '+919800000000',
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
    gstin: '27ABCDE1234F1Z5',
    pan: 'ABCDE1234F',
    email: null,
    phone: null,
    verificationStatus: 'APPROVED',
  },
};

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    applicationNumber: 'CR-202610-000123',
    customerProfileId: 'cust-1',
    creditProfileId: null,
    status: S.DRAFT,
    source: CreditApplicationSource.WEBSITE,
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
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    customerProfile,
    ...overrides,
  };
}

const REQUIRED_DOCS = [
  'gst_registration',
  'bank_statement',
  'itr_financials',
].map((documentType) => ({
  id: `doc-${documentType}`,
  documentNumber: `DOC-${documentType}`,
  category: DocumentCategory.CREDIT_APPLICATION,
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
  createdAt: new Date(),
  updatedAt: new Date(),
}));

describe('server-side source resolution', () => {
  it('attributes the production website and its preview deployments', () => {
    expect(
      resolveClientSource(
        { origin: 'https://swaroop-website.vercel.app' },
        ORIGINS,
      ).source,
    ).toBe(CreditApplicationSource.WEBSITE);
    expect(
      resolveClientSource(
        { origin: 'https://swaroop-website-git-main-team.vercel.app' },
        ORIGINS,
      ).source,
    ).toBe(CreditApplicationSource.WEBSITE);
  });

  it('never lets a wildcard span a dot', () => {
    expect(
      originMatches(
        'https://swaroop-website-x.evil.vercel.app',
        'https://swaroop-website-*.vercel.app',
      ),
    ).toBe(false);
  });

  it('maps each first-party web app to its own source', () => {
    const resolve = (origin: string) =>
      resolveClientSource({ origin }, ORIGINS).source;
    expect(resolve('https://swaroop-customer-webapp.vercel.app')).toBe(
      CreditApplicationSource.CUSTOMER_WEB,
    );
    expect(resolve('https://swaroop-seller-webapp.vercel.app')).toBe(
      CreditApplicationSource.SELLER_WEB,
    );
    expect(resolve('https://swaroop-admin-pi.vercel.app')).toBe(
      CreditApplicationSource.ADMIN,
    );
  });

  it('flags unknown browser origins instead of trusting them', () => {
    const resolved = resolveClientSource(
      { origin: 'https://example.com' },
      ORIGINS,
    );
    expect(resolved.source).toBe(CreditApplicationSource.CUSTOMER_WEB);
    expect(resolved.unrecognizedOrigin).toBe(true);
  });

  it('treats origin-less requests as native apps', () => {
    expect(resolveClientSource({}, ORIGINS).source).toBe(
      CreditApplicationSource.CUSTOMER_APP,
    );
    expect(
      resolveClientSource({ clientHeader: 'seller_app' }, ORIGINS).source,
    ).toBe(CreditApplicationSource.SELLER_APP);
  });

  it('ignores the native-client header when a browser origin is present', () => {
    expect(
      resolveClientSource(
        {
          origin: 'https://swaroop-website.vercel.app',
          clientHeader: 'SELLER_APP',
        },
        ORIGINS,
      ).source,
    ).toBe(CreditApplicationSource.WEBSITE);
  });
});

describe('credit application state machine', () => {
  it('only allows approval after review has started', () => {
    expect(canTransitionCredit(S.DRAFT, S.APPROVED)).toBe(false);
    expect(canTransitionCredit(S.PENDING, S.APPROVED)).toBe(false);
    expect(canTransitionCredit(S.UNDER_REVIEW, S.APPROVED)).toBe(true);
    expect(canTransitionCredit(S.INSURANCE_REVIEW, S.APPROVED)).toBe(true);
  });

  it('locks terminal statuses', () => {
    for (const terminal of [S.APPROVED, S.REJECTED, S.CANCELLED, S.EXPIRED]) {
      expect(canTransitionCredit(terminal, S.UNDER_REVIEW)).toBe(false);
      expect(canTransitionCredit(terminal, S.DRAFT)).toBe(false);
    }
  });

  it('offers only the actions valid for the current status', () => {
    const submitted = creditAdminActions(S.PENDING);
    expect(submitted).toContain('START_REVIEW');
    expect(submitted).toContain('REQUEST_RESUBMISSION');
    expect(submitted).not.toContain('APPROVE');

    const underReview = creditAdminActions(S.UNDER_REVIEW);
    expect(underReview).toContain('APPROVE');
    expect(underReview).not.toContain('START_REVIEW');

    expect(creditAdminActions(S.DRAFT)).not.toContain('REQUEST_RESUBMISSION');
    expect(creditAdminActions(S.REJECTED)).toEqual(['ASSIGN', 'ADD_REMARK']);
  });

  it('derives "resubmission required" from a reopened draft', () => {
    expect(creditDisplayStatus({ status: S.DRAFT, submittedAt: null })).toBe(
      S.DRAFT,
    );
    expect(
      creditDisplayStatus({ status: S.DRAFT, submittedAt: new Date() }),
    ).toBe('RESUBMISSION_REQUIRED');
  });
});

describe('customer submission tracking', () => {
  const prisma = {
    creditApplication: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    customerCreditProfile: { findUnique: vi.fn(), upsert: vi.fn() },
    customerProfile: { update: vi.fn() },
    document: { findMany: vi.fn() },
    userRole: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  const context = { requireCustomer: vi.fn() };
  const audit = { log: vi.fn() };
  const notifications = { create: vi.fn() };
  const timeline = { record: vi.fn(), list: vi.fn() };
  const website = {
    source: CreditApplicationSource.WEBSITE,
    origin: 'https://swaroop-website.vercel.app',
    unrecognizedOrigin: false,
  };
  let service: CustomerCreditService;

  beforeEach(() => {
    vi.clearAllMocks();
    context.requireCustomer.mockResolvedValue({
      userId: 'user-1',
      customerProfileId: 'cust-1',
      organizationId: 'org-1',
      status: 'ACTIVE',
      organizationName: 'Acme Fuels',
    });
    prisma.creditApplication.findFirst.mockResolvedValue(null);
    prisma.creditApplication.findUnique.mockResolvedValue(null);
    prisma.customerCreditProfile.findUnique.mockResolvedValue(null);
    prisma.document.findMany.mockResolvedValue([]);
    prisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-1' }]);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    );
    timeline.list.mockResolvedValue([]);
    service = new CustomerCreditService(
      prisma as never,
      context as never,
      audit as never,
      notifications as never,
      { inspect: vi.fn() } as never,
      {} as never,
      timeline as never,
      { isConfigured: () => true } as never,
    );
  });

  it('stores the server-resolved source and drops client-claimed source', async () => {
    prisma.creditApplication.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) =>
        application({ ...data, id: 'app-1' }),
    );

    await service.saveDraft(
      'user-1',
      {
        requestedLimit: 500000,
        metadata: {
          source: 'ADMIN',
          status: 'APPROVED',
          applicant: { companyName: 'Acme' },
        },
      },
      website,
    );

    const data = prisma.creditApplication.create.mock.calls[0][0].data;
    expect(data.source).toBe(CreditApplicationSource.WEBSITE);
    expect(data.status).toBe(S.DRAFT);
    expect(data.applicationNumber).toMatch(/^CR-\d{6}-\d{6}$/);
    expect(data.metadata).toEqual({ applicant: { companyName: 'Acme' } });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('retries when a generated application number collides', async () => {
    let calls = 0;
    prisma.creditApplication.create.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['applicationNumber'] },
        });
      }
      return application();
    });

    const result = await service.saveDraft(
      'user-1',
      { requestedLimit: 500000 },
      website,
    );

    expect(calls).toBe(2);
    expect(result.applicationNumber).toBe('CR-202610-000123');
  });

  it('returns the same result when an already-submitted application is submitted again', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: S.PENDING, submittedAt: new Date() }),
    );

    const result = await service.submit('user-1', 'app-1', website);

    expect(result.alreadySubmitted).toBe(true);
    expect(result.applicationNumber).toBe('CR-202610-000123');
    expect(prisma.creditApplication.updateMany).not.toHaveBeenCalled();
    expect(timeline.record).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('lets only one of two concurrent submits move the draft', async () => {
    prisma.creditApplication.findUnique
      .mockResolvedValueOnce(application())
      .mockResolvedValueOnce(
        application({ status: S.PENDING, submittedAt: new Date() }),
      );
    prisma.document.findMany.mockResolvedValue(REQUIRED_DOCS);
    prisma.creditApplication.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.submit('user-1', 'app-1', website);

    expect(result.alreadySubmitted).toBe(true);
    expect(prisma.creditApplication.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'app-1', status: S.DRAFT } }),
    );
    expect(timeline.record).not.toHaveBeenCalled();
  });

  it('records the channel and notifies admins with the source on submit', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(application());
    prisma.document.findMany.mockResolvedValue(REQUIRED_DOCS);
    prisma.creditApplication.updateMany.mockResolvedValue({ count: 1 });
    prisma.creditApplication.findUniqueOrThrow.mockResolvedValue(
      application({ status: S.PENDING, submittedAt: new Date() }),
    );

    const result = await service.submit('user-1', 'app-1', website);

    expect(result.alreadySubmitted).toBe(false);
    expect(result.status).toBe(S.PENDING);
    expect(result.source).toBe(CreditApplicationSource.WEBSITE);
    expect(timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CREDIT_APPLICATION_SUBMITTED',
        metadata: expect.objectContaining({
          channel: 'WEBSITE',
          fromStatus: S.DRAFT,
          toStatus: S.PENDING,
        }),
      }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        title: 'New credit application from Website',
      }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('marks a reopened draft as a resubmission and clears the request message', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({
        submittedAt: new Date('2026-10-02T00:00:00Z'),
        customerMessage: 'Upload a clearer bank statement',
      }),
    );
    prisma.document.findMany.mockResolvedValue(REQUIRED_DOCS);
    prisma.creditApplication.updateMany.mockResolvedValue({ count: 1 });
    prisma.creditApplication.findUniqueOrThrow.mockResolvedValue(
      application({ status: S.PENDING, submittedAt: new Date() }),
    );

    await service.submit('user-1', 'app-1', website);

    expect(
      prisma.creditApplication.updateMany.mock.calls[0][0].data,
    ).toMatchObject({ status: S.PENDING, customerMessage: null });
    expect(timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Credit application resubmitted for review',
      }),
    );
  });

  it('lists only the signed-in customer applications with display status', async () => {
    prisma.creditApplication.findMany.mockResolvedValue([
      application({ submittedAt: new Date(), customerMessage: 'Fix GST' }),
    ]);

    const rows = await service.listApplications('user-1');

    expect(prisma.creditApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerProfileId: 'cust-1' } }),
    );
    expect(rows[0].displayStatus).toBe('RESUBMISSION_REQUIRED');
    expect(rows[0]).not.toHaveProperty('notes');
    expect(rows[0]).not.toHaveProperty('metadata');
  });
});

describe('admin credit application tracking', () => {
  const prisma = {
    creditApplication: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn(),
    },
    customerCreditProfile: { findUnique: vi.fn(), upsert: vi.fn() },
    customerProfile: { update: vi.fn() },
    document: { findMany: vi.fn(), findFirst: vi.fn() },
    auditLog: { findMany: vi.fn() },
    kycVerification: { findMany: vi.fn() },
    user: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const audit = { log: vi.fn() };
  const documents = { download: vi.fn() };
  const notifications = { create: vi.fn() };
  const timeline = { record: vi.fn(), list: vi.fn() };
  const storage = { isConfigured: vi.fn(() => true) };
  let service: AdminCreditService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.creditApplication.updateMany.mockResolvedValue({ count: 1 });
    prisma.document.findMany.mockResolvedValue([]);
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.kycVerification.findMany.mockResolvedValue([]);
    prisma.customerCreditProfile.upsert.mockResolvedValue({ id: 'credit-1' });
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    );
    timeline.list.mockResolvedValue([]);
    storage.isConfigured.mockReturnValue(true);
    service = new AdminCreditService(
      prisma as never,
      audit as never,
      { recordTransaction: vi.fn(), refreshBalances: vi.fn() } as never,
      documents as never,
      notifications as never,
      storage as never,
      timeline as never,
    );
  });

  it('refuses to approve an application nobody has reviewed', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: S.PENDING, submittedAt: new Date() }),
    );

    await expect(
      service.approve('app-1', 'admin-1', { approvedLimit: 100000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.creditApplication.updateMany).not.toHaveBeenCalled();
  });

  it('reports a conflict when another admin changed the status first', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: S.PENDING, submittedAt: new Date() }),
    );
    prisma.creditApplication.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.startReview('app-1', 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(timeline.record).not.toHaveBeenCalled();
  });

  it('starts review with an audited from/to event and notifies the customer', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: S.PENDING, submittedAt: new Date() }),
    );

    await service.startReview('app-1', 'admin-1');

    expect(prisma.creditApplication.updateMany).toHaveBeenCalledWith({
      where: { id: 'app-1', status: S.PENDING },
      data: { assignedAdminId: 'admin-1', status: S.UNDER_REVIEW },
    });
    expect(timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CREDIT_REVIEW_STARTED',
        metadata: { fromStatus: S.PENDING, toStatus: S.UNDER_REVIEW },
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        previousData: expect.objectContaining({ status: S.PENDING }),
        newData: expect.objectContaining({ status: S.UNDER_REVIEW }),
      }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('reopens an application for resubmission and tells the customer why', async () => {
    const submittedAt = new Date('2026-10-02T00:00:00Z');
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: S.UNDER_REVIEW, submittedAt }),
    );

    await service.requestResubmission('app-1', 'admin-1', {
      message: 'Please upload the last 6 months of bank statements.',
    });

    expect(prisma.creditApplication.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'app-1', status: S.UNDER_REVIEW },
        data: expect.objectContaining({
          status: S.DRAFT,
          submittedAt,
          customerMessage:
            'Please upload the last 6 months of bank statements.',
        }),
      }),
    );
    expect(timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CREDIT_RESUBMISSION_REQUESTED',
        customerVisible: true,
      }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('keeps admin remarks internal', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(
      application({ status: S.UNDER_REVIEW }),
    );

    await service.addRemark('app-1', 'admin-1', {
      remark: 'Called the CFO, statements look fine',
    });

    expect(timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CREDIT_ADMIN_REMARK',
        customerVisible: false,
      }),
    );
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('only assigns active admins with credit access', async () => {
    prisma.creditApplication.findUnique.mockResolvedValue(application());
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.assign('app-1', 'admin-1', { assigneeUserId: 'seller-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'seller-1',
          status: 'ACTIVE',
          userRoles: {
            some: {
              role: {
                code: { in: ['ADMIN', 'SUPER_ADMIN', 'FINANCE_MANAGER'] },
              },
            },
          },
        }),
      }),
    );
    expect(prisma.creditApplication.updateMany).not.toHaveBeenCalled();
  });

  it('does not hand out signed URLs for documents outside credit', async () => {
    prisma.document.findFirst.mockResolvedValue(null);

    await expect(
      service.downloadDocument('doc-order-invoice', 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(documents.download).not.toHaveBeenCalled();
    expect(prisma.document.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: [
          { ownerType: EntityOwnerType.CREDIT },
          { category: { in: expect.any(Array) } },
        ],
      }),
    });
  });

  it('audits credit document downloads without storing the URL', async () => {
    prisma.document.findFirst.mockResolvedValue(REQUIRED_DOCS[0]);
    documents.download.mockResolvedValue({
      id: 'doc-gst_registration',
      url: 'https://signed.example/secret',
    });

    await service.downloadDocument('doc-gst_registration', 'admin-1');

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREDIT_DOCUMENT_DOWNLOADED' }),
    );
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain(
      'signed.example',
    );
  });

  it('computes KPIs and the source breakdown from the database', async () => {
    prisma.creditApplication.groupBy
      .mockResolvedValueOnce([
        { status: S.PENDING, _count: { _all: 3 } },
        { status: S.UNDER_REVIEW, _count: { _all: 2 } },
        { status: S.DOCUMENTS_REQUIRED, _count: { _all: 1 } },
        { status: S.APPROVED, _count: { _all: 4 } },
        { status: S.REJECTED, _count: { _all: 1 } },
        { status: S.DRAFT, _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([
        { source: CreditApplicationSource.WEBSITE, _count: { _all: 5 } },
        { source: CreditApplicationSource.CUSTOMER_APP, _count: { _all: 4 } },
        { source: null, _count: { _all: 3 } },
      ]);
    prisma.creditApplication.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2);

    const stats = await service.applicationStats({});

    expect(stats.total).toBe(12);
    expect(stats.pendingReview).toBe(3);
    expect(stats.documentsRequired).toBe(1);
    expect(stats.resubmissionRequired).toBe(1);
    expect(stats.approved).toBe(4);
    expect(stats.rejected).toBe(1);
    expect(stats.website).toBe(5);
    expect(stats.websiteToday).toBe(1);
    expect(stats.websiteThisMonth).toBe(5);
    expect(stats.draftsInProgress).toBe(2);
    expect(stats.bySource).toEqual(
      expect.arrayContaining([
        { source: 'WEBSITE', label: 'Website', count: 5 },
        { source: null, label: 'Not recorded', count: 3 },
      ]),
    );
  });
});

describe('admin list filters', () => {
  it('filters by source, including legacy rows without one', () => {
    expect(buildApplicationsWhere({ source: 'WEBSITE' })).toEqual({
      AND: [{ source: 'WEBSITE' }],
    });
    expect(buildApplicationsWhere({ source: 'NOT_RECORDED' })).toEqual({
      AND: [{ source: null }],
    });
  });

  it('separates fresh drafts from reopened ones', () => {
    expect(buildApplicationsWhere({ status: 'RESUBMISSION_REQUIRED' })).toEqual(
      { AND: [{ status: S.DRAFT, submittedAt: { not: null } }] },
    );
    expect(buildApplicationsWhere({ status: S.DRAFT })).toEqual({
      AND: [{ status: S.DRAFT, submittedAt: null }],
    });
  });

  it('maps KYC buckets onto organization verification status', () => {
    expect(buildApplicationsWhere({ kycStatus: 'MANUAL_REVIEW' })).toEqual({
      AND: [
        {
          customerProfile: {
            organization: { verificationStatus: { in: ['UNDER_REVIEW'] } },
          },
        },
      ],
    });
  });

  it('searches application number, company, GSTIN, email and mobile', () => {
    const where = buildApplicationsWhere({ search: '98000 00000' });
    const json = JSON.stringify(where);
    for (const field of ['applicationNumber', 'gstin', 'legalName', 'email']) {
      expect(json).toContain(field);
    }
    expect(json).toContain('"phone":{"contains":"9800000000"}');
  });

  it('sorts newest first by default', () => {
    expect(applicationsOrderBy(undefined)).toEqual([{ createdAt: 'desc' }]);
    expect(applicationsOrderBy('amount_desc')[0]).toEqual({
      requestedLimit: 'desc',
    });
  });

  it('computes India day and month boundaries', () => {
    const { dayStart, monthStart } = istPeriodStarts(
      new Date('2026-10-08T20:00:00Z'),
    );
    // 20:00 UTC is 01:30 IST on Oct 9 → day starts at Oct 8 18:30 UTC.
    expect(dayStart.toISOString()).toBe('2026-10-08T18:30:00.000Z');
    expect(monthStart.toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });
});

describe('admin application mapper', () => {
  it('reads source from the column, masks PAN and ignores metadata source', () => {
    const mapped = mapApplication(
      application({
        status: S.PENDING,
        submittedAt: new Date(),
        source: null,
        metadata: { source: 'WEBSITE', applicant: { companyName: 'Acme' } },
      }) as never,
    );
    expect(mapped.source).toBeNull();
    expect(mapped.sourceLabel).toBe('Not recorded');
    expect(mapped.customer.pan).not.toBe('ABCDE1234F');
    expect(mapped.customer.pan).toMatch(/^AB/);
    expect(mapped.kycStatus).toBe('VERIFIED');
    expect(mapped.displayStatus).toBe(S.PENDING);
  });
});
