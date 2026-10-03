import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KycVerificationStatus,
  KycVerificationType,
} from '../../../../generated/prisma/client.js';
import { CustomerKycVerificationService } from './customer-kyc-verification.service.js';
import { hashIdentifier } from './kyc-identifiers.js';
import {
  classifyGst,
  classifyPan,
  KycVerificationProvider,
  type KycProviderOutcome,
} from './kyc-verification.provider.js';

const ctx = {
  userId: 'user-1',
  customerProfileId: 'cust-1',
  organizationId: 'org-1',
  status: 'ACTIVE',
  organizationName: 'Customer Organization',
};

type Row = {
  id: string;
  type: KycVerificationType;
  status: KycVerificationStatus;
  identifierHash: string;
  identifierMasked: string;
  provider: string;
  result: unknown;
  failureCode: string | null;
  failureReason: string | null;
  verifiedAt: Date | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

describe('CustomerKycVerificationService', () => {
  const prisma = {
    customerProfile: { findUniqueOrThrow: vi.fn() },
    organization: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    kycVerification: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
  const config = { get: vi.fn(() => 10_000) };
  const customerContext = { getOrCreateCustomer: vi.fn() };
  const provider = {
    verify: vi.fn(),
    providerName: vi.fn(() => 'http'),
  };
  const audit = { log: vi.fn() };
  let rows: Row[];
  let kycStatus: string;
  let service: CustomerKycVerificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    kycStatus = 'NOT_SUBMITTED';
    customerContext.getOrCreateCustomer.mockResolvedValue(ctx);
    prisma.customerProfile.findUniqueOrThrow.mockImplementation(async () => ({
      metadata: { kyc: { status: kycStatus } },
    }));
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ gstin: null });
    prisma.kycVerification.findFirst.mockImplementation(
      async (args: { where: { type: KycVerificationType } }) =>
        rows.filter((row) => row.type === args.where.type).at(-1) ?? null,
    );
    prisma.kycVerification.create.mockImplementation(
      async (args: { data: Partial<Row> }) => {
        const row = {
          id: `ver-${rows.length + 1}`,
          result: null,
          failureCode: null,
          failureReason: null,
          verifiedAt: null,
          reviewedAt: null,
          createdAt: new Date(),
          ...args.data,
        } as Row;
        rows.push(row);
        return row;
      },
    );
    prisma.kycVerification.update.mockImplementation(
      async (args: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((item) => item.id === args.where.id)!;
        Object.assign(row, args.data);
        return row;
      },
    );
    service = new CustomerKycVerificationService(
      prisma as never,
      config as never,
      customerContext as never,
      provider as never,
      audit as never,
    );
  });

  it('rejects malformed PANs without calling the provider', async () => {
    await expect(service.verifyPan('user-1', 'ABC123')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(provider.verify).not.toHaveBeenCalled();
  });

  it('stores a verified PAN on the organization and audits only the masked value', async () => {
    provider.verify.mockResolvedValue({
      outcome: 'VERIFIED',
      details: { nameOnPan: 'KARAN VEER', panStatus: 'Valid' },
    } satisfies KycProviderOutcome);

    const result = await service.verifyPan('user-1', ' aapfu0939f ');

    expect(provider.verify).toHaveBeenCalledWith('PAN', 'AAPFU0939F');
    expect(result).toMatchObject({
      status: 'VERIFIED',
      method: 'PROVIDER',
      identifierMasked: 'AA•••••39F',
      warning: null,
    });
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { pan: 'AAPFU0939F' },
    });
    expect(audit.log.mock.calls.map(([entry]) => entry.action)).toEqual([
      'CUSTOMER_KYC_PAN_VERIFICATION_STARTED',
      'CUSTOMER_KYC_PAN_VERIFIED',
    ]);
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('AAPFU0939F');
  });

  it('does not save a PAN the provider could not find', async () => {
    provider.verify.mockResolvedValue({
      outcome: 'FAILED',
      code: 'PAN_NOT_FOUND',
      reason: 'This PAN could not be found in Income Tax records.',
    } satisfies KycProviderOutcome);

    const result = await service.verifyPan('user-1', 'AAPFU0939F');

    expect(result.status).toBe('FAILED');
    expect(result.message).toMatch(/could not be found/);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('falls back to manual review when no provider is configured', async () => {
    provider.verify.mockResolvedValue({ outcome: 'NOT_CONFIGURED' });

    const result = await service.verifyGst('user-1', '27AAPFU0939F1ZV');

    expect(result).toMatchObject({
      status: 'MANUAL_REVIEW',
      method: null,
      message: expect.stringMatching(/compliance team will verify/),
    });
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { gstin: '27AAPFU0939F1ZV' },
    });
  });

  it('reuses a recent verified result for the same identifier', async () => {
    rows.push({
      id: 'ver-old',
      type: KycVerificationType.GST,
      status: KycVerificationStatus.VERIFIED,
      identifierHash: hashIdentifier('GST', '27AAPFU0939F1ZV'),
      identifierMasked: '27AA•••••••F1ZV',
      provider: 'http',
      result: { legalName: 'Karan Veer Industries Pvt Ltd' },
      failureCode: null,
      failureReason: null,
      verifiedAt: new Date(),
      reviewedAt: null,
      createdAt: new Date(),
    });

    const result = await service.verifyGst('user-1', '27AAPFU0939F1ZV');

    expect(result.id).toBe('ver-old');
    expect(provider.verify).not.toHaveBeenCalled();
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: {
        gstin: '27AAPFU0939F1ZV',
        legalName: 'Karan Veer Industries Pvt Ltd',
      },
    });
  });

  it('shares one provider request between concurrent identical calls', async () => {
    let resolve!: (value: KycProviderOutcome) => void;
    provider.verify.mockReturnValue(
      new Promise<KycProviderOutcome>((done) => (resolve = done)),
    );

    const first = service.verifyPan('user-1', 'AAPFU0939F');
    const second = service.verifyPan('user-1', 'AAPFU0939F');
    await vi.waitFor(() => expect(provider.verify).toHaveBeenCalled());
    resolve({ outcome: 'VERIFIED', details: {} });

    const [a, b] = await Promise.all([first, second]);
    expect(a.id).toBe(b.id);
    expect(provider.verify).toHaveBeenCalledTimes(1);
    expect(prisma.kycVerification.create).toHaveBeenCalledTimes(1);
  });

  it('warns when the GSTIN does not belong to the verified PAN', async () => {
    rows.push({
      id: 'ver-pan',
      type: KycVerificationType.PAN,
      status: KycVerificationStatus.VERIFIED,
      identifierHash: hashIdentifier('PAN', 'ABCDE1234F'),
      identifierMasked: 'AB•••••34F',
      provider: 'http',
      result: {},
      failureCode: null,
      failureReason: null,
      verifiedAt: new Date(),
      reviewedAt: null,
      createdAt: new Date(),
    });
    provider.verify.mockResolvedValue({
      outcome: 'VERIFIED',
      details: { legalName: 'Other Co', gstStatus: 'Active' },
    });

    const result = await service.verifyGst('user-1', '27AAPFU0939F1ZV');

    expect(result.status).toBe('VERIFIED');
    expect(result.warning).toMatch(/not registered to your verified PAN/);
  });

  it('locks PAN and GST changes while KYC is under review', async () => {
    kycStatus = 'SUBMITTED';
    await expect(service.verifyPan('user-1', 'AAPFU0939F')).rejects.toThrow(
      /under review/,
    );
    expect(provider.verify).not.toHaveBeenCalled();
  });
});

describe('KycVerificationProvider', () => {
  const settings = {
    'kyc.pan': {
      name: 'acme',
      url: 'https://kyc.example/pan',
      apiKey: 'secret-key',
      clientId: 'client',
    },
    'kyc.gst': { name: 'http', url: '', apiKey: '', clientId: '' },
    'kyc.requestTimeoutMs': 5000,
  } as Record<string, unknown>;
  const config = { get: (key: string) => settings[key] };
  const provider = new KycVerificationProvider(config as never);
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reports NOT_CONFIGURED without a provider URL', async () => {
    expect(provider.isConfigured('GST')).toBe(false);
    expect(provider.providerName('GST')).toBe('manual');
    expect(await provider.verify('GST', '27AAPFU0939F1ZV')).toEqual({
      outcome: 'NOT_CONFIGURED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends credentials server-side and normalizes the response', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { full_name: 'KARAN VEER', status: 'VALID', category: 'Firm' },
        }),
        { status: 200 },
      ),
    );

    const outcome = await provider.verify('PAN', 'AAPFU0939F');

    expect(outcome).toMatchObject({
      outcome: 'VERIFIED',
      details: { nameOnPan: 'KARAN VEER', panCategory: 'Firm' },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://kyc.example/pan');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(
      'secret-key',
    );
    expect(JSON.parse(init.body as string)).toEqual({ pan: 'AAPFU0939F' });
  });

  it('maps 404 to FAILED and 5xx / network errors to UNAVAILABLE', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    expect(await provider.verify('PAN', 'AAPFU0939F')).toMatchObject({
      outcome: 'FAILED',
      code: 'PAN_NOT_FOUND',
    });

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    expect(await provider.verify('PAN', 'AAPFU0939F')).toMatchObject({
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_HTTP_503',
    });

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await provider.verify('PAN', 'AAPFU0939F')).toMatchObject({
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_UNREACHABLE',
    });
  });

  it('classifies GSTN-style payloads', () => {
    expect(
      classifyGst({
        result: {
          lgnm: 'Karan Veer Industries Pvt Ltd',
          tradeNam: 'KV Polymers',
          sts: 'Active',
          pradr: { adr: 'Plot 4, MIDC, Pune', addr: { pncd: '411019' } },
        },
      }),
    ).toMatchObject({
      outcome: 'VERIFIED',
      details: {
        legalName: 'Karan Veer Industries Pvt Ltd',
        tradeName: 'KV Polymers',
        gstStatus: 'Active',
      },
    });
    expect(classifyGst({ lgnm: 'Old Co', sts: 'Cancelled' })).toMatchObject({
      outcome: 'FAILED',
      code: 'GSTIN_INACTIVE',
    });
    expect(classifyGst({})).toMatchObject({
      outcome: 'FAILED',
      code: 'GSTIN_NOT_FOUND',
    });
    expect(classifyPan({ status: 'Deleted' })).toMatchObject({
      outcome: 'FAILED',
      code: 'PAN_INACTIVE',
    });
  });
});
