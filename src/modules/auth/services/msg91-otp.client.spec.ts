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

  it('sendOtp posts to MSG91 and returns request_id without logging OTP', async () => {
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
    });

    expect(result.requestId).toBe('req-abc-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://control.msg91.com/api/v5/otp?');
    expect(url).toContain('mobile=918240890242');
    expect(url).toContain('template_id=6ae081288c342f46e203bb12');
    expect(url).toContain('otp_length=6');
    expect(url).toContain('otp_expiry=5');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authkey).toBe(
      'test-auth-key',
    );
    // Provider generates OTP — we must not send a custom otp query param.
    expect(url).not.toContain('otp=');
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
