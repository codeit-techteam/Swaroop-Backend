import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HttpKycVerificationProvider,
  KycVerificationProvider,
} from './kyc-verification.provider.js';
import {
  classifySurepassGst,
  classifySurepassPan,
  SurepassVerificationProvider,
} from './surepass-verification.provider.js';

const GSTIN = '19AAPFU0939F1ZM';

const gstBody = (overrides: Record<string, unknown> = {}) => ({
  data: {
    client_id: 'corporate_gstin_abc123',
    gstin: GSTIN,
    pan_number: 'AAPFU0939F',
    business_name: 'KV POLYMERS',
    legal_name: 'KARAN VEER INDUSTRIES PRIVATE LIMITED',
    state_jurisdiction: 'State - West Bengal,Zone - Kolkata North',
    date_of_registration: '2018-10-12',
    constitution_of_business: 'Private Limited Company',
    taxpayer_type: 'Regular',
    gstin_status: 'Active',
    address: '12, Park Street, Kolkata, West Bengal, 700016',
    ...overrides,
  },
  status_code: 200,
  success: true,
  message: null,
  message_code: 'success',
});

const panBody = {
  data: {
    client_id: 'pan_xyz789',
    pan_number: 'AAPFU0939F',
    full_name: 'KARAN VEER',
    category: 'person',
  },
  status_code: 200,
  success: true,
  message: null,
  message_code: 'success',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('Surepass response classification', () => {
  it('normalizes a verified GSTIN using only provider-reported fields', () => {
    const outcome = classifySurepassGst(200, gstBody(), GSTIN);
    expect(outcome).toEqual({
      outcome: 'VERIFIED',
      referenceId: 'corporate_gstin_abc123',
      linkedPan: 'AAPFU0939F',
      details: expect.objectContaining({
        legalName: 'KARAN VEER INDUSTRIES PRIVATE LIMITED',
        tradeName: 'KV POLYMERS',
        gstStatus: 'Active',
        state: 'West Bengal',
        stateCode: '19',
        panMasked: 'AA•••••39F',
        constitution: 'Private Limited Company',
        address: '12, Park Street, Kolkata, West Bengal, 700016',
      }),
    });
    // The raw PAN is only handed back for the mismatch check, never persisted in details.
    expect(
      JSON.stringify((outcome as { details: unknown }).details),
    ).not.toContain('AAPFU0939F');
  });

  it('omits fields the provider did not return', () => {
    const outcome = classifySurepassGst(
      200,
      gstBody({ state_jurisdiction: null, address: null }),
      GSTIN,
    );
    expect(outcome.outcome).toBe('VERIFIED');
    const details = (outcome as { details: Record<string, unknown> }).details;
    expect(details.state).toBeNull();
    expect(details.address).toBeNull();
  });

  it('rejects inactive GSTINs', () => {
    expect(
      classifySurepassGst(200, gstBody({ gstin_status: 'Cancelled' }), GSTIN),
    ).toMatchObject({ outcome: 'FAILED', code: 'GSTIN_INACTIVE' });
  });

  it('maps verification_failed to not found', () => {
    const body = {
      data: { client_id: 'c1' },
      status_code: 422,
      success: false,
      message: 'Verification Failed.',
      message_code: 'verification_failed',
    };
    expect(classifySurepassGst(422, body, GSTIN)).toMatchObject({
      outcome: 'FAILED',
      code: 'GSTIN_NOT_FOUND',
      referenceId: 'c1',
    });
    expect(classifySurepassPan(422, body)).toMatchObject({
      outcome: 'FAILED',
      code: 'PAN_NOT_FOUND',
    });
  });

  it('treats a success payload without a name as malformed, not verified', () => {
    expect(
      classifySurepassPan(200, { success: true, data: { client_id: 'x' } }),
    ).toMatchObject({
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_MALFORMED_RESPONSE',
    });
  });

  it('verifies a PAN', () => {
    expect(classifySurepassPan(200, panBody)).toMatchObject({
      outcome: 'VERIFIED',
      referenceId: 'pan_xyz789',
      details: { nameOnPan: 'KARAN VEER', panCategory: 'person' },
    });
  });
});

describe('SurepassVerificationProvider', () => {
  const settings: Record<string, unknown> = {
    'kyc.surepass': {
      baseUrl: 'https://kyc-api.surepass.io/api/v1',
      token: 'sp-secret-token',
      environment: 'production',
      panPath: '/pan/pan',
      gstPath: '/corporate/gstin',
    },
    'kyc.requestTimeoutMs': 50,
  };
  const config = { get: (key: string) => settings[key] };
  const provider = new SurepassVerificationProvider(config as never);
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts id_number with a bearer token to the configured endpoint', async () => {
    fetchMock.mockResolvedValue(json(panBody));

    const outcome = await provider.verify('PAN', 'AAPFU0939F');

    expect(outcome.outcome).toBe('VERIFIED');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://kyc-api.surepass.io/api/v1/pan/pan');
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer sp-secret-token',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      id_number: 'AAPFU0939F',
    });
  });

  it('uses the GST path for GSTINs', async () => {
    fetchMock.mockResolvedValue(json(gstBody()));
    await provider.verify('GST', GSTIN);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://kyc-api.surepass.io/api/v1/corporate/gstin',
    );
  });

  it('reports an invalid token as unavailable without leaking it', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue(json({ message: 'Unauthorized' }, 401));
    const outcome = await provider.verify('PAN', 'AAPFU0939F');
    expect(outcome).toMatchObject({
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_AUTH_FAILED',
    });
    expect(JSON.stringify(outcome)).not.toContain('sp-secret-token');
    warn.mockRestore();
  });

  it('maps rate limiting and malformed bodies to unavailable', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 429));
    expect(await provider.verify('PAN', 'AAPFU0939F')).toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
    });

    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    expect(await provider.verify('PAN', 'AAPFU0939F')).toMatchObject({
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_MALFORMED_RESPONSE',
    });
  });

  it('does not treat a bare 404 (wrong endpoint) as "not found"', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'Not Found' }, 404));
    expect(await provider.verify('GST', GSTIN)).toMatchObject({
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_HTTP_404',
    });
  });

  it('retries once on a gateway error, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json(gstBody()));
    expect((await provider.verify('GST', GSTIN)).outcome).toBe('VERIFIED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('times out instead of hanging', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    expect(await provider.verify('PAN', 'AAPFU0939F')).toMatchObject({
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_TIMEOUT',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('KycVerificationProvider routing', () => {
  it('prefers Surepass when configured and falls back to manual review otherwise', async () => {
    const surepass = {
      isConfigured: vi.fn(() => true),
      verify: vi.fn(async () => ({ outcome: 'NOT_CONFIGURED' as const })),
    };
    const http = {
      isConfigured: vi.fn(() => false),
      providerName: vi.fn(() => 'manual'),
      verify: vi.fn(),
    };
    const facade = new KycVerificationProvider(
      surepass as never,
      http as unknown as HttpKycVerificationProvider,
    );
    expect(facade.providerName('PAN')).toBe('surepass');
    await facade.verify('PAN', 'AAPFU0939F');
    expect(surepass.verify).toHaveBeenCalled();
    expect(http.verify).not.toHaveBeenCalled();

    surepass.isConfigured.mockReturnValue(false);
    expect(facade.providerName('GST')).toBe('manual');
    expect(facade.isConfigured('GST')).toBe(false);
  });
});
