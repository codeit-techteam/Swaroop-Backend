import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toMsg91Mobile } from '../utils/phone.util.js';
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
 * Official MSG91 SendOTP v5 API.
 * @see https://docs.msg91.com/otp
 * Payload aligned with MSG91 panel "Template Code" for OTP_Template1:
 *   POST control.msg91.com/api/v5/otp?template_id=&mobile=
 *   body: { "OTP": "<code>" }
 * plus query `otp` so ##OTP## is substituted for DLT-safe content.
 *
 * Never log auth keys or OTP values.
 *
 * API `type=success` only means MSG91 accepted the request. Handset delivery
 * can still Fail in MSG91 Logs (DLT scrubbing). Configure the OTP webhook for
 * failureReason visibility.
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

  toMsg91Mobile(e164Phone: string): string {
    try {
      return toMsg91Mobile(e164Phone);
    } catch {
      throw new Msg91ProviderError(
        'Invalid mobile number for MSG91',
        'INVALID_MOBILE',
      );
    }
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

    // Match MSG91 Template Code + SendOTP v5 docs. template_id is mandatory —
    // rows with Template-OTP "-" in MSG91 Logs are usually panel Test DLT /
    // retry, not this path.
    const url = new URL(MSG91_OTP_BASE);
    url.searchParams.set('template_id', templateId);
    url.searchParams.set('mobile', mobile);
    url.searchParams.set('otp_length', String(otpLength));
    url.searchParams.set('otp_expiry', String(otpExpiryMinutes));
    url.searchParams.set('realTimeResponse', '1');

    // Never log this value. Query `otp` fills ##OTP##; body OTP matches Template Code.
    if (params.otp) {
      url.searchParams.set('otp', params.otp);
    }

    const configuredSender = (
      this.configService.get<string>('otp.msg91.senderId') ?? ''
    ).trim();
    const dltHeader = (
      this.configService.get<string>('otp.msg91.header') ?? ''
    ).trim();
    const senderId =
      configuredSender ||
      dltHeader ||
      (templateId === '6ae081288c342f46e203bb12' ? 'VELPLY' : '');
    if (senderId) {
      url.searchParams.set('sender', senderId);
    }

    // India DLT ids — NEVER put these in the JSON body. MSG91 Template Code
    // for OTP_Template1 is only `{ "OTP": "..." }`. Stuffing DLT_TE_ID into
    // the body lands in `extra_param` and can confuse DLT scrubbing.
    //
    // DLT_TE_ID  = Airtel Content Template Id (MSG91_DLT_TEMPLATE_ID)
    // PE_ID      = Airtel Principal Entity / Registration Id (MSG91_DLT_ENTITY_ID)
    //              — NOT Header DLT Id, NOT Content Template Id
    // Failure "Invalid DLT Entity Id" means PE_ID is blank/wrong on the request
    // or on the MSG91 Sender Id mapping for VELPLY.
    const dltTemplateId = (
      this.configService.get<string>('otp.msg91.dltTemplateId') ?? ''
    ).trim();
    if (dltTemplateId) {
      url.searchParams.set('DLT_TE_ID', dltTemplateId);
    }

    const dltEntityId = (
      this.configService.get<string>('otp.msg91.dltEntityId') ?? ''
    ).trim();
    if (dltEntityId && dltEntityId !== dltTemplateId) {
      url.searchParams.set('PE_ID', dltEntityId);
    } else if (dltEntityId && dltEntityId === dltTemplateId) {
      this.logger.error({
        event: 'msg91.otp.send.entity_id_equals_template_id',
        correlationId,
        mobile: masked,
        hint: 'MSG91_DLT_ENTITY_ID must be the Airtel PE/Entity Id (dashboard), not the Content Template Id',
      });
    }

    // Official Template Code body — OTP variable only.
    const body: Record<string, string> = {};
    if (params.otp) {
      body.OTP = params.otp;
    }

    this.logger.log({
      event: 'msg91.otp.send.request',
      correlationId,
      mobile: masked,
      api: 'sendotp_v5',
      templateId,
      senderId: senderId || 'n/a',
      dltTemplateId: dltTemplateId || 'missing',
      dltEntityConfigured: Boolean(
        dltEntityId && dltEntityId !== dltTemplateId,
      ),
      otpExpiryMinutes,
      otpLength,
      hasBodyOtp: Boolean(body.OTP),
      hasQueryOtp: Boolean(params.otp),
    });

    if (!dltTemplateId) {
      this.logger.warn({
        event: 'msg91.otp.send.missing_dlt_template_id',
        correlationId,
        mobile: masked,
        hint: 'Set MSG91_DLT_TEMPLATE_ID (Airtel Content Template Id 1077…)',
      });
    }
    if (!dltEntityId) {
      this.logger.warn({
        event: 'msg91.otp.send.missing_dlt_entity_id',
        correlationId,
        mobile: masked,
        hint: 'Set MSG91_DLT_ENTITY_ID to Airtel PE Id (19-digit, usually starts with 100). MSG91 Logs show "Invalid DLT Entity Id" without this / panel mapping.',
      });
    }

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
