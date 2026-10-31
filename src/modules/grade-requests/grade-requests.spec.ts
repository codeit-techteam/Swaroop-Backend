import { describe, expect, it, vi } from 'vitest';
import { NewGradeRequestStatus as S } from '../../generated/prisma/client.js';
import { CustomerGradeRequestsService } from './customer-grade-requests.service.js';
import { AdminGradeRequestsService } from './admin-grade-requests.service.js';
import {
  GRADE_REQUEST_TRANSITIONS,
  OPEN_GRADE_REQUEST_STATUSES,
  TERMINAL_GRADE_REQUEST_STATUSES,
  canTransition,
  normalizeDedupeKey,
  normalizeIndianMobile,
  toCustomerTimeline,
} from './grade-requests.shared.js';

describe('grade request shared rules', () => {
  it('open + terminal statuses partition every status', () => {
    const all = Object.values(S);
    expect(
      [
        ...OPEN_GRADE_REQUEST_STATUSES,
        ...TERMINAL_GRADE_REQUEST_STATUSES,
      ].sort(),
    ).toEqual([...all].sort());
  });

  it('terminal statuses have no outgoing transitions', () => {
    for (const s of TERMINAL_GRADE_REQUEST_STATUSES) {
      expect(GRADE_REQUEST_TRANSITIONS[s]).toEqual([]);
    }
  });

  it('allows the documented lifecycle and blocks shortcuts', () => {
    expect(canTransition(S.SUBMITTED, S.UNDER_REVIEW)).toBe(true);
    expect(canTransition(S.UNDER_REVIEW, S.INFO_REQUIRED)).toBe(true);
    expect(canTransition(S.INFO_REQUIRED, S.UNDER_REVIEW)).toBe(true);
    expect(canTransition(S.GRADE_IDENTIFIED, S.CONVERTED_TO_PR)).toBe(true);
    // cannot skip straight to a quotation from submission, or reopen a closed request
    expect(canTransition(S.SUBMITTED, S.QUOTATION_AVAILABLE)).toBe(false);
    expect(canTransition(S.SUBMITTED, S.CONVERTED_TO_PR)).toBe(false);
    expect(canTransition(S.CLOSED, S.UNDER_REVIEW)).toBe(false);
    expect(canTransition(S.REJECTED, S.SUBMITTED)).toBe(false);
  });

  it('normalises the duplicate key (case + whitespace)', () => {
    expect(normalizeDedupeKey('  F4811  Grade ', ' Reliance ')).toBe(
      normalizeDedupeKey('f4811 grade', 'RELIANCE'),
    );
    expect(normalizeDedupeKey('F4811', null)).not.toBe(
      normalizeDedupeKey('F4811', 'Reliance'),
    );
  });

  it('validates Indian mobile numbers', () => {
    expect(normalizeIndianMobile('98765 43210')).toBe('+919876543210');
    expect(normalizeIndianMobile('+91-9876543210')).toBe('+919876543210');
    expect(normalizeIndianMobile('1234567890')).toBeNull();
    expect(normalizeIndianMobile('98765')).toBeNull();
    expect(normalizeIndianMobile('abcdefghij')).toBeNull();
  });

  it('customer timeline hides internal notes and admin identity', () => {
    const t = toCustomerTimeline([
      {
        id: '1',
        eventType: 'INTERNAL_NOTE',
        fromStatus: null,
        toStatus: null,
        actorRole: 'ADMIN',
        actorUserId: 'admin-1',
        message: 'competitor pricing is X',
        internal: true,
        createdAt: new Date(),
      },
      {
        id: '2',
        eventType: 'INFO_REQUESTED',
        fromStatus: S.UNDER_REVIEW,
        toStatus: S.INFO_REQUIRED,
        actorRole: 'ADMIN',
        actorUserId: 'admin-1',
        message: 'Please share MFI',
        internal: false,
        createdAt: new Date(),
      },
    ]);
    expect(t).toHaveLength(1);
    expect(t[0].actor).toBe('POLYSTOREX');
    expect(JSON.stringify(t)).not.toContain('admin-1');
    expect(JSON.stringify(t)).not.toContain('competitor');
  });
});

// ---------------------------------------------------------------------------
// Customer service
// ---------------------------------------------------------------------------

const CTX = {
  userId: 'user-1',
  customerProfileId: 'cp-1',
  organizationId: 'org-1',
  organizationName: 'Acme Plastics',
};

function validDto(over: Record<string, unknown> = {}) {
  return {
    gradeName: 'F4811 Masterbatch',
    materialCategory: 'White Masterbatch',
    manufacturer: 'Acme Chem',
    quantity: 25,
    unit: 'MT',
    deliveryLocation: 'Mundra, Gujarat',
    contactName: 'Asha Rao',
    contactPhone: '9876543210',
    ...over,
  } as never;
}

function customerSetup(
  opts: {
    openDuplicate?: boolean;
    catalogueMatches?: unknown[];
    ownerProfileId?: string;
  } = {},
) {
  const created: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const row = (data: Record<string, unknown>) => ({
    id: 'req-1',
    submittedAt: new Date('2026-10-31T00:00:00Z'),
    updatedAt: new Date('2026-10-31T00:00:00Z'),
    requiredByDate: null,
    resolvedGrade: null,
    adminMessage: null,
    closureReason: null,
    customerResponse: null,
    assignedAdminId: null,
    quantity: { toString: () => String(data.quantity ?? 25) },
    ...data,
  });
  const prisma: Record<string, unknown> = {
    newGradeRequest: {
      findUnique: vi.fn(async (args: { where: Record<string, string> }) => {
        if (args.where.referenceNumber) return null;
        if (args.where.idempotencyKey) return null;
        return row({
          customerProfileId: opts.ownerProfileId ?? 'cp-1',
          referenceNumber: 'NGR-2026-000001',
          status: S.INFO_REQUIRED,
          requestedById: 'user-1',
        });
      }),
      findFirst: vi.fn(async () =>
        opts.openDuplicate
          ? {
              id: 'old',
              referenceNumber: 'NGR-2026-000009',
              status: S.UNDER_REVIEW,
            }
          : null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return row(data);
      }),
    },
    newGradeRequestEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      }),
    },
    grade: { findMany: vi.fn(async () => opts.catalogueMatches ?? []) },
    gradeCategory: { findFirst: vi.fn(async () => ({ id: 'cat-1' })) },
    address: { findFirst: vi.fn(async () => null) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );

  const support = {
    recordEvent: vi.fn(async (_db: unknown, e: Record<string, unknown>) => {
      events.push(e);
    }),
    audit: vi.fn(async () => undefined),
    notifyAdmins: vi.fn(async () => undefined),
    notifyCustomer: vi.fn(async () => undefined),
  };
  const service = new CustomerGradeRequestsService(
    prisma as never,
    { requireCustomer: vi.fn(async () => CTX) } as never,
    {} as never,
    { isConfigured: () => false, getMaxDocumentSizeBytes: () => 1 } as never,
    support as never,
  );
  return { service, prisma, support, created, events };
}

describe('CustomerGradeRequestsService.create', () => {
  it('creates a persistent SUBMITTED request with a unique reference and notifies admins', async () => {
    const { service, created, support } = customerSetup();
    const result = await service.create('user-1', validDto());

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      customerProfileId: 'cp-1', // associated with the authenticated customer
      requestedById: 'user-1',
      status: S.SUBMITTED,
      contactPhone: '+919876543210',
    });
    expect(String(created[0].referenceNumber)).toMatch(/^NGR-\d{4}-\d{6}$/);
    expect(result.status).toBe(S.SUBMITTED);
    expect(result.statusLabel).toBe('Submitted');
    expect(support.recordEvent).toHaveBeenCalled();
    expect(support.notifyAdmins).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid phone number', async () => {
    const { service, created } = customerSetup();
    await expect(
      service.create('user-1', validDto({ contactPhone: '12345' })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_CONTACT_PHONE' }),
    });
    expect(created).toHaveLength(0);
  });

  it('rejects a past required-by date', async () => {
    const { service } = customerSetup();
    await expect(
      service.create('user-1', validDto({ requiredByDate: '2020-01-01' })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_REQUIRED_BY_DATE' }),
    });
  });

  it('blocks a second OPEN request for the same grade+manufacturer', async () => {
    const { service, created } = customerSetup({ openDuplicate: true });
    await expect(service.create('user-1', validDto())).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DUPLICATE_OPEN_REQUEST',
        details: {
          existing: expect.objectContaining({
            referenceNumber: 'NGR-2026-000009',
          }),
        },
      }),
    });
    expect(created).toHaveLength(0);
  });

  it('suggests catalogue matches instead of creating a duplicate grade request', async () => {
    const match = {
      id: 'g1',
      code: 'F4811',
      name: 'F4811',
      displayName: 'F4811',
      gradeNo: 'F4811',
      manufacturer: 'Acme Chem',
    };
    const { service, created } = customerSetup({ catalogueMatches: [match] });
    await expect(service.create('user-1', validDto())).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'GRADE_ALREADY_IN_CATALOGUE',
        details: {
          matches: [expect.objectContaining({ id: 'g1', code: 'F4811' })],
        },
      }),
    });
    expect(created).toHaveLength(0);
  });

  it('allows submission when the customer acknowledges the existing grade', async () => {
    const { service, created } = customerSetup({
      catalogueMatches: [{ id: 'g1', code: 'F4811', name: 'F4811' }],
    });
    await service.create('user-1', validDto({ acknowledgeExisting: true }));
    expect(created).toHaveLength(1);
  });
});

describe('CustomerGradeRequestsService ownership & responses', () => {
  it("does not reveal another customer's request", async () => {
    const { service } = customerSetup({ ownerProfileId: 'someone-else' });
    await expect(service.getOne('user-1', 'req-1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('only accepts a response while information is required', async () => {
    const { service, prisma } = customerSetup();
    (
      prisma.newGradeRequest as { findUnique: ReturnType<typeof vi.fn> }
    ).findUnique = vi.fn(async () => ({
      id: 'req-1',
      customerProfileId: 'cp-1',
      referenceNumber: 'NGR-1',
      status: S.UNDER_REVIEW,
      resolvedGrade: null,
      requestedById: 'user-1',
      quantity: { toString: () => '1' },
      submittedAt: new Date(),
      updatedAt: new Date(),
    }));
    await expect(
      service.respond('user-1', 'req-1', { message: 'here is the MFI' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESPONSE_NOT_REQUESTED' }),
    });
  });

  it('never reveals an unpublished (admin-created, hidden) resolved grade', async () => {
    const { service, prisma } = customerSetup();
    (
      prisma.newGradeRequest as { findUnique: ReturnType<typeof vi.fn> }
    ).findUnique = vi.fn(async () => ({
      id: 'req-1',
      customerProfileId: 'cp-1',
      referenceNumber: 'NGR-1',
      status: S.GRADE_IDENTIFIED,
      requestedById: 'user-1',
      quantity: { toString: () => '1' },
      submittedAt: new Date(),
      updatedAt: new Date(),
      resolvedGrade: {
        id: 'g-new',
        code: 'SECRET-1',
        name: 'Unpublished',
        displayName: null,
        status: 'INACTIVE',
        customerVisible: false,
        deletedAt: null,
      },
    }));
    (
      prisma as { newGradeRequestEvent: Record<string, unknown> }
    ).newGradeRequestEvent.findMany = vi.fn(async () => []);
    (prisma as Record<string, unknown>).document = {
      findMany: vi.fn(async () => []),
    };
    const view = await service.getOne('user-1', 'req-1');
    expect(view.resolvedGrade).toBeNull();
    expect(JSON.stringify(view)).not.toContain('SECRET-1');
  });
});

// ---------------------------------------------------------------------------
// Admin service
// ---------------------------------------------------------------------------

function adminRow(status: S, over: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    referenceNumber: 'NGR-2026-000001',
    status,
    requestedById: 'user-1',
    assignedAdminId: null,
    resolvedGradeId: null,
    reviewedAt: null,
    customerProfile: {
      id: 'cp-1',
      organizationId: 'org-1',
      organization: { id: 'org-1', name: 'Acme' },
      user: { id: 'user-1', email: 'a@b.c', phone: '+911' },
    },
    category: null,
    assignedAdmin: null,
    resolvedGrade: null,
    quantity: { toString: () => '10' },
    submittedAt: new Date(),
    updatedAt: new Date(),
    requiredByDate: null,
    ...over,
  };
}

function adminSetup(status: S, over: Record<string, unknown> = {}) {
  const row = adminRow(status, over);
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const prisma: Record<string, unknown> = {
    newGradeRequest: {
      findUnique: vi.fn(async () => row),
      updateMany,
      update: vi.fn(async () => row),
    },
    newGradeRequestEvent: { findMany: vi.fn(async () => []) },
    document: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
    userRole: { findFirst: vi.fn(async () => ({ userId: 'admin-1' })) },
    grade: {
      findFirst: vi.fn(async () => ({
        id: 'g-1',
        code: 'F4811',
        name: 'F4811',
      })),
      update: vi.fn(async () => ({})),
    },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  const support = {
    recordEvent: vi.fn(async () => undefined),
    audit: vi.fn(async () => undefined),
    notifyCustomer: vi.fn(async () => undefined),
    statusNotification: vi.fn(() => ({ title: 't', body: 'b' })),
  };
  const grades = {
    create: vi.fn(async (dto: Record<string, unknown>) => ({
      id: 'g-new',
      code: String(dto.code).toUpperCase(),
    })),
  };
  const service = new AdminGradeRequestsService(
    prisma as never,
    support as never,
    grades as never,
    {} as never,
    { isConfigured: () => false } as never,
  );
  return { service, support, grades, updateMany, prisma };
}

const ADMIN = { id: 'admin-1', roles: ['ADMIN'] };

describe('AdminGradeRequestsService', () => {
  it('moves status along a valid transition, records history and notifies the customer', async () => {
    const { service, support, updateMany } = adminSetup(S.SUBMITTED);
    await service.changeStatus('req-1', { status: S.UNDER_REVIEW }, ADMIN);
    expect(updateMany).toHaveBeenCalled();
    expect(support.recordEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fromStatus: S.SUBMITTED,
        toStatus: S.UNDER_REVIEW,
        actorUserId: 'admin-1', // responsible admin recorded
      }),
    );
    expect(support.audit).toHaveBeenCalled();
    expect(support.notifyCustomer).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid transition', async () => {
    const { service, updateMany } = adminSetup(S.SUBMITTED);
    await expect(
      service.changeStatus('req-1', { status: S.QUOTATION_AVAILABLE }, ADMIN),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('requires a customer-visible reason to reject or close', async () => {
    const { service } = adminSetup(S.UNDER_REVIEW);
    await expect(
      service.changeStatus('req-1', { status: S.REJECTED }, ADMIN),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REASON_REQUIRED' }),
    });
  });

  it('forces the dedicated actions for INFO_REQUIRED and GRADE_IDENTIFIED', async () => {
    const { service } = adminSetup(S.UNDER_REVIEW);
    for (const status of [S.INFO_REQUIRED, S.GRADE_IDENTIFIED]) {
      await expect(
        service.changeStatus('req-1', { status }, ADMIN),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'USE_DEDICATED_ACTION' }),
      });
    }
  });

  it('cannot convert to a purchase request before a grade is resolved', async () => {
    const { service } = adminSetup(S.GRADE_IDENTIFIED, {
      resolvedGradeId: null,
    });
    await expect(
      service.changeStatus('req-1', { status: S.CONVERTED_TO_PR }, ADMIN),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'GRADE_NOT_RESOLVED' }),
    });
  });

  it('request-info moves to INFO_REQUIRED with the message shown to the customer', async () => {
    const { service, support } = adminSetup(S.UNDER_REVIEW);
    await service.requestInfo(
      'req-1',
      { message: 'Please share MFI and density' },
      ADMIN,
    );
    expect(support.recordEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'INFO_REQUESTED',
        toStatus: S.INFO_REQUIRED,
        message: 'Please share MFI and density',
      }),
    );
  });

  it('internal notes are stored as internal events', async () => {
    const { service, support } = adminSetup(S.UNDER_REVIEW);
    await service.addNote('req-1', { note: 'call supplier' }, ADMIN);
    expect(support.recordEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ internal: true, eventType: 'INTERNAL_NOTE' }),
    );
  });

  it('maps an existing grade and marks the request GRADE_IDENTIFIED', async () => {
    const { service, updateMany } = adminSetup(S.UNDER_REVIEW);
    await service.mapGrade('req-1', { gradeId: 'g-1' }, ADMIN);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: S.GRADE_IDENTIFIED,
          resolvedGradeId: 'g-1',
          resolutionType: 'MAPPED_EXISTING',
        }),
      }),
    );
  });

  it('creates the new catalogue grade UNPUBLISHED (inactive, hidden)', async () => {
    const { service, grades } = adminSetup(S.UNDER_REVIEW);
    const res = await service.createGrade(
      'req-1',
      { code: 'f4811', name: 'F4811', categoryId: 'cat-1' },
      ADMIN,
    );
    expect(grades.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'INACTIVE',
        customerVisible: false,
        sellerVisible: false,
      }),
      'admin-1',
    );
    expect(res.publicationRequired).toBe(true);
  });

  it('refuses to create a second grade for an already-resolved request', async () => {
    const { service, grades } = adminSetup(S.GRADE_IDENTIFIED, {
      resolvedGradeId: 'g-1',
    });
    await expect(
      service.createGrade(
        'req-1',
        { code: 'X1', name: 'X', categoryId: 'c' },
        ADMIN,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'GRADE_ALREADY_RESOLVED' }),
    });
    expect(grades.create).not.toHaveBeenCalled();
  });

  it('closed requests cannot be re-assigned', async () => {
    const { service } = adminSetup(S.CLOSED);
    await expect(service.assign('req-1', {}, ADMIN)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REQUEST_CLOSED' }),
    });
  });

  it('only core admins can assign to someone else', async () => {
    const { service } = adminSetup(S.UNDER_REVIEW);
    await expect(
      service.assign(
        'req-1',
        { adminUserId: 'other-admin' },
        { id: 'proc-1', roles: ['PROCUREMENT_MANAGER'] },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});

// ---------------------------------------------------------------------------
// DTO validation (what the HTTP layer enforces before the service runs)
// ---------------------------------------------------------------------------
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateGradeRequestDto,
  GradeRequestDocumentDto,
} from './grade-requests.dto.js';

async function dtoErrors(cls: new () => object, body: Record<string, unknown>) {
  const errs = await validate(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errs.map((e) => e.property).sort();
}

describe('CreateGradeRequestDto validation', () => {
  const minimal = {
    gradeName: 'F4811',
    materialCategory: 'White Masterbatch',
    quantity: 10,
    unit: 'MT',
    deliveryLocation: 'Mundra, Gujarat',
    contactName: 'Asha',
    contactPhone: '9876543210',
  };

  it('accepts the minimal set — optional business fields are not forced', async () => {
    expect(await dtoErrors(CreateGradeRequestDto, minimal)).toEqual([]);
  });

  it('reports every missing required field', async () => {
    expect(await dtoErrors(CreateGradeRequestDto, {})).toEqual(
      [
        'contactName',
        'contactPhone',
        'deliveryLocation',
        'gradeName',
        'materialCategory',
        'quantity',
        'unit',
      ].sort(),
    );
  });

  it('rejects zero/negative quantity, bad unit, bad pincode, bad email', async () => {
    expect(
      await dtoErrors(CreateGradeRequestDto, { ...minimal, quantity: 0 }),
    ).toContain('quantity');
    expect(
      await dtoErrors(CreateGradeRequestDto, { ...minimal, quantity: -5 }),
    ).toContain('quantity');
    expect(
      await dtoErrors(CreateGradeRequestDto, { ...minimal, unit: 'BAGS' }),
    ).toContain('unit');
    expect(
      await dtoErrors(CreateGradeRequestDto, {
        ...minimal,
        deliveryPincode: '12',
      }),
    ).toContain('deliveryPincode');
    expect(
      await dtoErrors(CreateGradeRequestDto, {
        ...minimal,
        contactEmail: 'nope',
      }),
    ).toContain('contactEmail');
  });

  it('rejects unknown fields (no mass-assignment of status/customer)', async () => {
    expect(
      await dtoErrors(CreateGradeRequestDto, {
        ...minimal,
        status: 'CONVERTED_TO_PR',
        customerProfileId: 'x',
      }),
    ).toEqual(['customerProfileId', 'status']);
  });
});

describe('GradeRequestDocumentDto validation', () => {
  it('accepts an allowed technical document type', async () => {
    expect(
      await dtoErrors(GradeRequestDocumentDto, {
        documentType: 'TDS',
        fileName: 'datasheet.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
      }),
    ).toEqual([]);
  });

  it('rejects disallowed document types and oversized files', async () => {
    expect(
      await dtoErrors(GradeRequestDocumentDto, {
        documentType: 'KYC',
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
      }),
    ).toContain('documentType');
    expect(
      await dtoErrors(GradeRequestDocumentDto, {
        documentType: 'TDS',
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 999_999_999,
      }),
    ).toContain('fileSizeBytes');
  });
});
