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
const PAN = 'AAPFU0939F';
const HOLDER = { fullName: 'KARAN VEER', dob: '1990-01-01' };

/** Shape of the documented Corporate GSTIN response. */
const gstBody = (overrides: Record<string, unknown> = {}) => ({
  data: {
    address_details: {},
    client_id: 'corporate_gstin_abc123',
    gstin: GSTIN,
    pan_number: 'AAPFU0939F',
    business_name: 'KV POLYMERS',
    legal_name: 'KARAN VEER INDUSTRIES PRIVATE LIMITED',
    center_jurisdiction: 'Commissionerate - KOLKATA NORTH,Division - DIV 1',
    state_jurisdiction: 'State - West Bengal,Zone - Kolkata North',
    date_of_registration: '2018-10-12',
    constitution_of_business: 'Private Limited Company',
    taxpayer_type: 'Regular',
    gstin_status: 'Active',
    date_of_cancellation: '1800-01-01',
    field_visit_conducted: 'No',
    nature_bus_activities: ['Wholesale Business'],
    aadhaar_validation: 'Yes',
    filing_status: [],
    address: '12, Park Street, Kolkata, West Bengal, 700016',
    hsn_info: {},
    filing_frequency: [],
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
        pincode: '700016',
        cancellationDate: null,
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

  it('rejects inactive GSTINs and keeps a real cancellation date', () => {
    expect(
      classifySurepassGst(
        200,
        gstBody({
          gstin_status: 'Cancelled',
          date_of_cancellation: '2023-04-01',
        }),
        GSTIN,
      ),
    ).toMatchObject({
      outcome: 'FAILED',
      code: 'GSTIN_INACTIVE',
      details: { cancellationDate: '2023-04-01' },
    });
  });

  it('treats a response for a different GSTIN as malformed', () => {
    expect(
      classifySurepassGst(200, gstBody({ gstin: '27AAACR5055K2Z6' }), GSTIN),
    ).toMatchObject({
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_MALFORMED_RESPONSE',
    });
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
    expect(
      classifySurepassPan(422, body, { holderMatched: true }),
    ).toMatchObject({ outcome: 'FAILED', code: 'PAN_DETAILS_MISMATCH' });
  });

  it('treats a success payload without a name as malformed, not verified', () => {
    expect(
      classifySurepassPan(200, { success: true, data: { client_id: 'x' } }),
    ).toMatchObject({
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_MALFORMED_RESPONSE',
    });
  });

  it('verifies a PAN Lite response', () => {
    expect(classifySurepassPan(200, panBody)).toMatchObject({
      outcome: 'VERIFIED',
      referenceId: 'pan_xyz789',
      details: { nameOnPan: 'KARAN VEER', panCategory: 'person' },
    });
  });

  it('applies PAN Advanced status codes', () => {
    const advanced = (code: string, desc?: string) => ({
      ...panBody,
      data: {
        ...panBody.data,
        full_name: undefined,
        full_name_split: ['KARAN', '', 'VEER'],
        pan_status: code,
        ...(desc ? { pan_status_desc: desc } : {}),
      },
    });
    expect(
      classifySurepassPan(200, advanced('E', 'EXISTING AND VALID')),
    ).toMatchObject({
      outcome: 'VERIFIED',
      details: { nameOnPan: 'KARAN VEER', panStatus: 'EXISTING AND VALID' },
    });
    expect(classifySurepassPan(200, advanced('X'))).toMatchObject({
      outcome: 'FAILED',
      code: 'PAN_INACTIVE',
      details: { panStatus: 'Deactivated' },
    });
    expect(classifySurepassPan(200, advanced('EM'))).toMatchObject({
      outcome: 'REVIEW',
      code: 'PAN_EVENT_MARKED',
      details: { panStatus: 'Merger' },
    });
  });
});

describe('SurepassVerificationProvider', () => {
  const settings: Record<string, unknown> = {
    'kyc.surepass': {
      baseUrl: 'https://kyc-api.surepass.app',
      token: 'sp-secret-token',
      environment: 'production',
      panPath: '/api/v1/pan/pan-verify',
      gstPath: '/api/v1/corporate/gstin',
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

    const outcome = await provider.verify('PAN', 'AAPFU0939F', HOLDER);

    expect(outcome.outcome).toBe('VERIFIED');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://kyc-api.surepass.app/api/v1/pan/pan-verify');
    expect((init.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer sp-secret-token',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      id_number: 'AAPFU0939F',
      full_name: 'KARAN VEER',
      dob: '1990-01-01',
    });
  });

  it('requires holder details for PAN Verify without calling Surepass', async () => {
    expect(await provider.verify('PAN', PAN)).toMatchObject({
      outcome: 'FAILED',
      code: 'PAN_DETAILS_REQUIRED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a PAN Verify 422 as a details mismatch', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          data: null,
          status_code: 422,
          success: false,
          message: 'Verification Failed.',
          message_code: 'verification_failed',
        },
        422,
      ),
    );
    expect(await provider.verify('PAN', PAN, HOLDER)).toMatchObject({
      outcome: 'FAILED',
      code: 'PAN_DETAILS_MISMATCH',
    });
  });

  it('sends only id_number to PAN Lite', async () => {
    const lite = new SurepassVerificationProvider({
      get: (key: string) =>
        key === 'kyc.surepass'
          ? {
              ...(settings['kyc.surepass'] as object),
              panPath: '/api/v1/pan/pan',
            }
          : settings[key],
    } as never);
    fetchMock.mockResolvedValueOnce(json(panBody));
    expect((await lite.verify('PAN', PAN)).outcome).toBe('VERIFIED');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://kyc-api.surepass.app/api/v1/pan/pan');
    expect(JSON.parse(init.body as string)).toEqual({ id_number: PAN });
  });

  it('uses the GST path for GSTINs', async () => {
    fetchMock.mockResolvedValue(json(gstBody()));
    await provider.verify('GST', GSTIN);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://kyc-api.surepass.app/api/v1/corporate/gstin',
    );
  });

  it('maps exhausted balance and conflicts to unavailable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(
      json(
        {
          data: null,
          status_code: 403,
          success: false,
          message: 'API Balance Exhausted. Please recharge.',
          message_code: 'balance_exhausted',
        },
        403,
      ),
    );
    expect(await provider.verify('PAN', PAN, HOLDER)).toMatchObject({
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_BALANCE_EXHAUSTED',
    });

    fetchMock.mockResolvedValueOnce(json({ success: false }, 409));
    expect(await provider.verify('PAN', PAN, HOLDER)).toMatchObject({
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_CONFLICT',
    });
    error.mockRestore();
  });

  it('rejects a 400 as an invalid identifier', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          data: null,
          status_code: 400,
          success: false,
          message: 'Invalid GSTIN format',
          message_code: 'invalid_input',
        },
        400,
      ),
    );
    expect(await provider.verify('GST', GSTIN)).toMatchObject({
      outcome: 'FAILED',
      code: 'GSTIN_INVALID',
    });
  });

  it('reports an invalid token as unavailable without leaking it', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue(json({ message: 'Unauthorized' }, 401));
    const outcome = await provider.verify('PAN', 'AAPFU0939F', HOLDER);
    expect(outcome).toMatchObject({
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_AUTH_FAILED',
    });
    expect(JSON.stringify(outcome)).not.toContain('sp-secret-token');
    warn.mockRestore();
  });

  it('maps rate limiting and malformed bodies to unavailable', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 429));
    expect(await provider.verify('PAN', 'AAPFU0939F', HOLDER)).toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
    });

    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    expect(await provider.verify('PAN', 'AAPFU0939F', HOLDER)).toMatchObject({
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_MALFORMED_RESPONSE',
    });
  });

  it('does not treat a 404 as "not found"', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>Not Found</html>', { status: 404 }),
    );
    expect(await provider.verify('GST', GSTIN)).toMatchObject({
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_MALFORMED_RESPONSE',
    });
    fetchMock.mockResolvedValueOnce(
      json({ data: null, success: false, message: 'Client not found' }, 404),
    );
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

  it('retries a Surepass 500 once, then reports unavailable', async () => {
    const upstreamTimeout = {
      data: { client_id: 'verification_x' },
      status_code: 500,
      success: false,
      message: 'Backend Timed Out. Try Again.',
      message_code: 'contact_support',
    };
    fetchMock.mockImplementation(() =>
      Promise.resolve(json(upstreamTimeout, 500)),
    );
    expect(await provider.verify('PAN', PAN, HOLDER)).toMatchObject({
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_HTTP_500',
    });
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
    expect(await provider.verify('PAN', 'AAPFU0939F', HOLDER)).toMatchObject({
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
