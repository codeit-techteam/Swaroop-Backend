import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type Msg91SendResult = {
  requestId: string;
};

export type Msg91VerifyResult = {
  verified: boolean;
  message: string;
};

export type Msg91ResendResult = {
  requestId?: string;
};

type Msg91Json = {
  type?: string;
  message?: string;
  request_id?: string;
  code?: string | number;
};

const MSG91_OTP_BASE = 'https://control.msg91.com/api/v5/otp';
export const MSG91_CHALLENGE_PREFIX = 'msg91:req:';

/**
 * Official MSG91 OTP API (Send / Verify / Resend).
 * @see https://docs.msg91.com/otp
 *
 * Never log auth keys or OTP values.
 */
@Injectable()
export class Msg91OtpClient {
  private readonly logger = new Logger(Msg91OtpClient.name);

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    const provider = (
      this.configService.get<string>('otp.provider') ?? ''
    ).toLowerCase();
    if (provider !== 'msg91') return false;
    const authKey = this.configService.get<string>('otp.msg91.authKey') ?? '';
    const templateId =
      this.configService.get<string>('otp.msg91.templateId') ?? '';
    return authKey.length > 0 && templateId.length > 0;
  }

  /**
   * Convert E.164 (+91XXXXXXXXXX) to MSG91 mobile format (91XXXXXXXXXX).
   */
  toMsg91Mobile(e164Phone: string): string {
    const digits = e164Phone.replace(/\D/g, '');
    if (!digits) {
      throw new Error('Invalid mobile number for MSG91');
    }
    return digits;
  }

  async sendOtp(params: {
    e164Phone: string;
    otpLength: number;
    expiresInSeconds: number;
  }): Promise<Msg91SendResult> {
    const authKey = this.requireAuthKey();
    const templateId = this.requireTemplateId();
    const mobile = this.toMsg91Mobile(params.e164Phone);
    const otpExpiryMinutes = Math.max(
      1,
      Math.ceil(params.expiresInSeconds / 60),
    );
    const otpLength = Math.min(9, Math.max(4, params.otpLength));

    const url = new URL(MSG91_OTP_BASE);
    url.searchParams.set('mobile', mobile);
    url.searchParams.set('template_id', templateId);
    url.searchParams.set('otp_length', String(otpLength));
    url.searchParams.set('otp_expiry', String(otpExpiryMinutes));
    url.searchParams.set('realTimeResponse', '1');
    url.searchParams.set('unicode', '0');

    const senderId = this.configService.get<string>('otp.msg91.senderId');
    if (senderId) {
      url.searchParams.set('sender', senderId);
    }

    const body: Record<string, string> = {};
    // Approved template uses ##OTP## only — MSG91 injects the OTP.
    // Extra vars are omitted unless the dashboard template defines them.

    const response = await this.requestJson('POST', url, authKey, body);
    if (!this.isSuccess(response)) {
      this.logger.warn(
        `MSG91 send OTP failed type=${response.type ?? 'unknown'} code=${String(response.code ?? '')} msg=${this.safeMessage(response.message)}`,
      );
      throw new Error(
        this.safeMessage(response.message) || 'MSG91 OTP send failed',
      );
    }

    const requestId = (response.request_id ?? '').trim();
    if (!requestId) {
      this.logger.warn('MSG91 send OTP succeeded without request_id');
    }

    this.logger.log(
      `MSG91 OTP sent mobile_suffix=${mobile.slice(-4)} request_id=${requestId || 'n/a'}`,
    );

    return { requestId: requestId || `local-${Date.now()}` };
  }

  async verifyOtp(params: {
    e164Phone: string;
    otp: string;
  }): Promise<Msg91VerifyResult> {
    const authKey = this.requireAuthKey();
    const mobile = this.toMsg91Mobile(params.e164Phone);

    const url = new URL(`${MSG91_OTP_BASE}/verify`);
    url.searchParams.set('mobile', mobile);
    url.searchParams.set('otp', params.otp);

    const response = await this.requestJson('GET', url, authKey);
    if (!this.isSuccess(response)) {
      const message = this.safeMessage(response.message) || 'OTP verification failed';
      this.logger.warn(
        `MSG91 verify failed mobile_suffix=${mobile.slice(-4)} msg=${message}`,
      );
      return { verified: false, message };
    }

    this.logger.log(
      `MSG91 OTP verified mobile_suffix=${mobile.slice(-4)}`,
    );
    return { verified: true, message: 'OTP verified success' };
  }

  async resendOtp(params: {
    e164Phone: string;
    retryType?: 'text' | 'voice';
  }): Promise<Msg91ResendResult> {
    const authKey = this.requireAuthKey();
    const mobile = this.toMsg91Mobile(params.e164Phone);

    const url = new URL(`${MSG91_OTP_BASE}/retry`);
    url.searchParams.set('mobile', mobile);
    url.searchParams.set('retrytype', params.retryType ?? 'text');

    const response = await this.requestJson('GET', url, authKey);
    if (!this.isSuccess(response)) {
      this.logger.warn(
        `MSG91 resend failed mobile_suffix=${mobile.slice(-4)} msg=${this.safeMessage(response.message)}`,
      );
      throw new Error(
        this.safeMessage(response.message) || 'MSG91 OTP resend failed',
      );
    }

    return { requestId: response.request_id };
  }

  encodeChallengeRef(requestId: string): string {
    return `${MSG91_CHALLENGE_PREFIX}${requestId}`;
  }

  isProviderChallenge(otpHash: string): boolean {
    return otpHash.startsWith(MSG91_CHALLENGE_PREFIX);
  }

  private requireAuthKey(): string {
    const authKey = this.configService.get<string>('otp.msg91.authKey') ?? '';
    if (!authKey) {
      throw new Error('MSG91_AUTH_KEY is not configured');
    }
    return authKey;
  }

  private requireTemplateId(): string {
    const templateId =
      this.configService.get<string>('otp.msg91.templateId') ?? '';
    if (!templateId) {
      throw new Error('MSG91_OTP_TEMPLATE_ID is not configured');
    }
    return templateId;
  }

  private isSuccess(response: Msg91Json): boolean {
    if (String(response.code ?? '') === '201') return false;
    return (response.type ?? '').toLowerCase() === 'success';
  }

  private safeMessage(message: string | undefined): string {
    if (!message) return '';
    // Strip anything that looks like an OTP digit run from provider messages.
    return message.replace(/\b\d{4,9}\b/g, '[redacted]').slice(0, 200);
  }

  private async requestJson(
    method: 'GET' | 'POST',
    url: URL,
    authKey: string,
    body?: Record<string, string>,
  ): Promise<Msg91Json> {
    const controller = new AbortController();
    const timeoutMs =
      this.configService.get<number>('otp.msg91.timeoutMs') ?? 15_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          authkey: authKey,
        },
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        signal: controller.signal,
      });

      let json: Msg91Json = {};
      try {
        json = (await response.json()) as Msg91Json;
      } catch {
        json = {
          type: 'error',
          message: `MSG91 returned non-JSON (HTTP ${response.status})`,
        };
      }

      if (!response.ok && this.isSuccess(json)) {
        return {
          type: 'error',
          message: `MSG91 HTTP ${response.status}`,
          code: response.status,
        };
      }

      return json;
    } catch (error) {
      const aborted =
        error instanceof Error && error.name === 'AbortError';
      throw new Error(
        aborted
          ? 'MSG91 OTP request timed out'
          : error instanceof Error
            ? error.message
            : 'MSG91 OTP request failed',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
