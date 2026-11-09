import { afterEach, describe, expect, it, vi } from 'vitest';
import { Msg91OtpClient } from './msg91-otp.client.js';

const configGet = (map: Record<string, unknown>) => (key: string) => map[key];

describe('Msg91OtpClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const makeClient = (overrides: Record<string, unknown> = {}) => {
    const values: Record<string, unknown> = {
      'otp.provider': 'msg91',
      'otp.msg91.authKey': 'test-auth-key',
      'otp.msg91.templateId': '6ae081288c342f46e203bb12',
      'otp.msg91.senderId': 'VELPLY',
      'otp.msg91.dltTemplateId': '1077252360053463958',
      'otp.msg91.dltEntityId': '1005742923759773999',
      'otp.msg91.timeoutMs': 5_000,
      ...overrides,
    };
    return new Msg91OtpClient({
      get: configGet(values),
    } as never);
  };

  it('isConfigured requires provider + auth key + template', () => {
    expect(makeClient().isConfigured()).toBe(true);
    expect(
      makeClient({ 'otp.msg91.authKey': '' }).isConfigured(),
    ).toBe(false);
    expect(
      makeClient({ 'otp.provider': 'local' }).isConfigured(),
    ).toBe(false);
  });

  it('toMsg91Mobile strips plus and non-digits', () => {
    const client = makeClient();
    expect(client.toMsg91Mobile('+918240890242')).toBe('918240890242');
  });

  it('sendOtp posts to MSG91 with backend-generated OTP for ##OTP## delivery', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        type: 'success',
        request_id: 'req-abc-123',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = makeClient();
    const result = await client.sendOtp({
      e164Phone: '+918240890242',
      otpLength: 6,
      expiresInSeconds: 300,
      otp: '482913',
    });

    expect(result.requestId).toBe('req-abc-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://control.msg91.com/api/v5/otp?');
    expect(url).toContain('mobile=918240890242');
    expect(url).toContain('template_id=6ae081288c342f46e203bb12');
    expect(url).toContain('DLT_TE_ID=1077252360053463958');
    expect(url).toContain('PE_ID=1005742923759773999');
    expect(url).toContain('otp_length=6');
    expect(url).toContain('otp_expiry=5');
    expect(url).toContain('otp=482913');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authkey).toBe(
      'test-auth-key',
    );
    // Template Code body is OTP only — never DLT ids in JSON/extra_param.
    expect(JSON.parse(String(init.body))).toEqual({ OTP: '482913' });
  });

  it('does not send PE_ID when entity id equals content template id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ type: 'success', request_id: 'req-bad-pe' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await makeClient({
      'otp.msg91.dltEntityId': '1077252360053463958',
    }).sendOtp({
      e164Phone: '+918240890242',
      otpLength: 6,
      expiresInSeconds: 300,
      otp: '333444',
    });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('DLT_TE_ID=1077252360053463958');
    expect(url).not.toContain('PE_ID=');
  });

  it('omits DLT_TE_ID when MSG91_DLT_TEMPLATE_ID is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ type: 'success', request_id: 'req-no-dlt' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await makeClient({ 'otp.msg91.dltTemplateId': '' }).sendOtp({
      e164Phone: '+918240890242',
      otpLength: 6,
      expiresInSeconds: 300,
      otp: '111222',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('DLT_TE_ID=');
    expect(JSON.parse(String(init.body))).toEqual({ OTP: '111222' });
  });

  it('falls back to MSG91_HEADER VELPLY when senderId is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        type: 'success',
        request_id: 'req-header',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await makeClient({
      'otp.msg91.senderId': '',
      'otp.msg91.header': 'VELPLY',
    }).sendOtp({
      e164Phone: '+918240890242',
      otpLength: 6,
      expiresInSeconds: 300,
      otp: '123456',
    });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('sender=VELPLY');
  });

  it('passes explicit MSG91_SENDER_ID when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        type: 'success',
        request_id: 'req-sender',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await makeClient({
      'otp.msg91.senderId': 'VELPLY',
    }).sendOtp({
      e164Phone: '+918240890242',
      otpLength: 6,
      expiresInSeconds: 300,
      otp: '123456',
    });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('sender=VELPLY');
  });

  it('treats HTTP 200 error payload as send failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          type: 'error',
          message: 'Invalid authkey',
          code: '201',
        }),
      }),
    );

    await expect(
      makeClient().sendOtp({
        e164Phone: '+918240890242',
        otpLength: 6,
        expiresInSeconds: 300,
      }),
    ).rejects.toThrow(/Invalid authkey|MSG91/);
  });

  it('verifyOtp returns verified=true only on type=success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          type: 'success',
          message: 'OTP verified success',
        }),
      }),
    );

    const ok = await makeClient().verifyOtp({
      e164Phone: '+918240890242',
      otp: '482913',
    });
    expect(ok.verified).toBe(true);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          type: 'error',
          message: 'OTP not match',
        }),
      }),
    );

    const bad = await makeClient().verifyOtp({
      e164Phone: '+918240890242',
      otp: '000000',
    });
    expect(bad.verified).toBe(false);
  });

  it('encodeChallengeRef marks provider-managed challenges', () => {
    const client = makeClient();
    const ref = client.encodeChallengeRef('req-1');
    expect(ref).toBe('msg91:req:req-1');
    expect(client.isProviderChallenge(ref)).toBe(true);
    expect(client.isProviderChallenge('abcdef')).toBe(false);
  });
});
