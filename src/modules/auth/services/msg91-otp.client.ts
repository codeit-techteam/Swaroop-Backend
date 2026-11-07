import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  classifyMsg91Failure,
  maskPhoneForLog,
  Msg91ProviderError,
  type Msg91FailureReason,
} from './msg91-otp.errors.js';

export type Msg91SendResult = {
  requestId: string;
};

export type Msg91VerifyResult = {
  verified: boolean;
  message: string;
  reason?: Msg91FailureReason;
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
 *
 * Sender ID note: MSG91 OTP v5 templates are mapped to a DLT sender/header in
 * the MSG91 panel. Only pass `sender` when MSG91_SENDER_ID is explicitly set.
 * Do NOT fall back to MSG91_HEADER (e.g. VELPLY) — a mismatched sender query
 * param is a common cause of API-accepted SMS that never reaches the handset.
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
      throw new Msg91ProviderError(
        'Invalid mobile number for MSG91',
        'INVALID_MOBILE',
      );
    }
    return digits;
  }

  async sendOtp(params: {
    e164Phone: string;
    otpLength: number;
    expiresInSeconds: number;
    /**
     * Backend-generated OTP. When set, MSG91 delivers this value into the
     * approved ##OTP## template placeholder. Verification is done locally
     * against the HMAC hash — never returned to clients or logged.
     */
    otp?: string;
    /** Propagated into structured logs for frontend ↔ backend ↔ MSG91 tracing. */
    correlationId?: string;
  }): Promise<Msg91SendResult> {
    const authKey = this.requireAuthKey();
    const templateId = this.requireTemplateId();
    const mobile = this.toMsg91Mobile(params.e164Phone);
    const masked = maskPhoneForLog(params.e164Phone);
    const otpExpiryMinutes = Math.max(
      1,
      Math.ceil(params.expiresInSeconds / 60),
    );
    const otpLength = Math.min(9, Math.max(4, params.otpLength));
    const correlationId = params.correlationId ?? 'n/a';

    const url = new URL(MSG91_OTP_BASE);
    url.searchParams.set('mobile', mobile);
    url.searchParams.set('template_id', templateId);
    url.searchParams.set('otp_length', String(otpLength));
    url.searchParams.set('otp_expiry', String(otpExpiryMinutes));
    url.searchParams.set('realTimeResponse', '1');
    url.searchParams.set('unicode', '0');

    // Pass server-generated OTP for ##OTP## substitution (query) and for the
    // MSG91 Template Code body variable `OTP` shown on OTP_Template1.
    // Never log this value.
    if (params.otp) {
      url.searchParams.set('otp', params.otp);
    }

    // Only send sender when explicitly configured. OTP_Template1 in MSG91 is
    // mapped to route Sender ID AIR0993093271; Airtel DLT header is VELPLY.
    // Do NOT send sender=VELPLY — that is the DLT header, not the MSG91 sender.
    const senderId = (
      this.configService.get<string>('otp.msg91.senderId') ?? ''
    ).trim();
    if (senderId) {
      url.searchParams.set('sender', senderId);
    }

    // Matches MSG91 panel "Template Code" for OTP_Template1:
    // body: JSON.stringify({ OTP: "..." })
    const body: Record<string, string> = {};
    if (params.otp) {
      body.OTP = params.otp;
    }

    this.logger.log({
      event: 'msg91.otp.send.request',
      correlationId,
      mobile: masked,
      templateIdSuffix: templateId.slice(-6),
      templateConfigured: true,
      senderParam: senderId ? 'explicit' : 'omitted_use_template_mapping',
      bodyKeys: Object.keys(body),
      otpExpiryMinutes,
      otpLength,
    });

    let response: Msg91Json;
    try {
      response = await this.requestJson('POST', url, authKey, body);
    } catch (error) {
      if (error instanceof Msg91ProviderError) throw error;
      const aborted =
        error instanceof Error && error.name === 'AbortError';
      const reason: Msg91FailureReason = aborted ? 'TIMEOUT' : 'UNAVAILABLE';
      throw new Msg91ProviderError(
        aborted
          ? 'MSG91 OTP request timed out'
          : error instanceof Error
            ? error.message
            : 'MSG91 OTP request failed',
        reason,
      );
    }

    if (!this.isSuccess(response)) {
      const reason = classifyMsg91Failure(response.message, response.code);
      const safeMsg =
        this.safeMessage(response.message) || 'MSG91 OTP send failed';
      this.logger.warn({
        event: 'msg91.otp.send.rejected',
        correlationId,
        mobile: masked,
        reason,
        providerType: response.type ?? 'unknown',
        providerCode: response.code != null ? String(response.code) : undefined,
        providerMessage: safeMsg,
      });
      throw new Msg91ProviderError(safeMsg, reason, String(response.code ?? ''));
    }

    const requestId = (response.request_id ?? '').trim();
    if (!requestId) {
      this.logger.warn({
        event: 'msg91.otp.send.missing_request_id',
        correlationId,
        mobile: masked,
      });
    }

    this.logger.log({
      event: 'msg91.otp.send.accepted',
      correlationId,
      mobile: masked,
      providerRequestId: requestId || 'n/a',
    });

    return { requestId: requestId || `local-${Date.now()}` };
  }

  async verifyOtp(params: {
    e164Phone: string;
    otp: string;
    correlationId?: string;
  }): Promise<Msg91VerifyResult> {
    const authKey = this.requireAuthKey();
    const mobile = this.toMsg91Mobile(params.e164Phone);
    const masked = maskPhoneForLog(params.e164Phone);
    const correlationId = params.correlationId ?? 'n/a';

    const url = new URL(`${MSG91_OTP_BASE}/verify`);
    url.searchParams.set('mobile', mobile);
    url.searchParams.set('otp', params.otp);

    const response = await this.requestJson('GET', url, authKey);
    if (!this.isSuccess(response)) {
      const message =
        this.safeMessage(response.message) || 'OTP verification failed';
      const reason = classifyMsg91Failure(response.message, response.code);
      this.logger.warn({
        event: 'msg91.otp.verify.failed',
        correlationId,
        mobile: masked,
        reason,
        providerMessage: message,
      });
      return { verified: false, message, reason };
    }

    this.logger.log({
      event: 'msg91.otp.verify.ok',
      correlationId,
      mobile: masked,
    });
    return { verified: true, message: 'OTP verified success' };
  }

  async resendOtp(params: {
    e164Phone: string;
    retryType?: 'text' | 'voice';
    correlationId?: string;
  }): Promise<Msg91ResendResult> {
    const authKey = this.requireAuthKey();
    const mobile = this.toMsg91Mobile(params.e164Phone);
    const masked = maskPhoneForLog(params.e164Phone);
    const correlationId = params.correlationId ?? 'n/a';

    const url = new URL(`${MSG91_OTP_BASE}/retry`);
    url.searchParams.set('mobile', mobile);
    url.searchParams.set('retrytype', params.retryType ?? 'text');

    const response = await this.requestJson('GET', url, authKey);
    if (!this.isSuccess(response)) {
      const reason = classifyMsg91Failure(response.message, response.code);
      const safeMsg =
        this.safeMessage(response.message) || 'MSG91 OTP resend failed';
      this.logger.warn({
        event: 'msg91.otp.resend.rejected',
        correlationId,
        mobile: masked,
        reason,
        providerMessage: safeMsg,
      });
      throw new Msg91ProviderError(safeMsg, reason, String(response.code ?? ''));
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
      throw new Msg91ProviderError(
        'MSG91_AUTH_KEY is not configured',
        'INVALID_AUTHKEY',
      );
    }
    return authKey;
  }

  private requireTemplateId(): string {
    const templateId =
      this.configService.get<string>('otp.msg91.templateId') ?? '';
    if (!templateId) {
      throw new Msg91ProviderError(
        'MSG91_OTP_TEMPLATE_ID is not configured',
        'INVALID_TEMPLATE',
      );
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
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new Msg91ProviderError(
        aborted
          ? 'MSG91 OTP request timed out'
          : error instanceof Error
            ? error.message
            : 'MSG91 OTP request failed',
        aborted ? 'TIMEOUT' : 'UNAVAILABLE',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
