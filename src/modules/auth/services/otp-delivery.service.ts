import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Msg91OtpClient } from './msg91-otp.client.js';
import { maskPhoneForLog, Msg91ProviderError } from './msg91-otp.errors.js';

export interface OtpDeliveryPayload {
  identifier: string;
  identifierType: 'PHONE' | 'EMAIL';
  purpose: string;
  /**
   * Backend-generated OTP to deliver. Never logged. When MSG91 is active this
   * is passed to the provider for ##OTP## template substitution.
   */
  otp: string;
  /**
   * Force the local/no-SMS stub (demo fixed OTP). Never call MSG91.
   */
  forceLocal?: boolean;
  /** Frontend ↔ backend ↔ MSG91 correlation. */
  correlationId?: string;
}

export type OtpDeliveryResult = {
  provider: 'msg91' | 'local' | 'none';
  /** MSG91 request_id when provider is msg91 (audit only — not used for verify). */
  providerRequestId?: string;
};

/**
 * Provider abstraction for SMS/email OTP delivery.
 *
 * Production phone OTP: backend generates the OTP, stores only an HMAC hash,
 * and MSG91 delivers the plaintext via the approved DLT template (##OTP##).
 * Verification is local against the hash — MSG91 Verify is kept for legacy
 * challenges that still store a `msg91:req:` reference.
 */
@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly msg91: Msg91OtpClient,
  ) {}

  /**
   * True when phone OTPs must be delivered through MSG91.
   */
  isMsg91PhoneProvider(): boolean {
    return this.msg91.isConfigured();
  }

  async send(payload: OtpDeliveryPayload): Promise<OtpDeliveryResult> {
    const env = this.configService.get<string>('app.env');
    const correlationId = payload.correlationId ?? 'n/a';
    const useMsg91 =
      payload.identifierType === 'PHONE' &&
      this.msg91.isConfigured() &&
      !payload.forceLocal;

    if (useMsg91) {
      const otpLength =
        this.configService.get<number>('security.otpLength') ?? 6;
      const expiresIn =
        this.configService.get<number>('security.otpExpiresInSeconds') ?? 300;

      const result = await this.msg91.sendOtp({
        e164Phone: payload.identifier,
        otpLength,
        expiresInSeconds: expiresIn,
        otp: payload.otp,
        correlationId,
      });

      return {
        provider: 'msg91',
        providerRequestId: result.requestId,
      };
    }

    if (payload.identifierType === 'PHONE' && !payload.forceLocal) {
      const requireProvider =
        this.configService.get<boolean>('otp.requireProviderInProduction') ===
          true ||
        this.configService.get<boolean>('security.authStrictOtp') === true;

      if (requireProvider) {
        this.logger.error({
          event: 'otp.delivery.refused',
          correlationId,
          reason: 'MSG91_NOT_CONFIGURED',
          purpose: payload.purpose,
        });
        throw new Msg91ProviderError(
          'OTP SMS provider is not configured. Set MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID.',
          'INVALID_AUTHKEY',
        );
      }
    }

    // Local / email stub — never log OTP values or full phone numbers.
    const maskedIdentifier =
      payload.identifierType === 'PHONE'
        ? maskPhoneForLog(payload.identifier)
        : '[email]';
    this.logger.log({
      event: 'otp.delivery.local_stub',
      correlationId,
      identifierType: payload.identifierType,
      identifier: maskedIdentifier,
      purpose: payload.purpose,
      env,
      provider: 'local',
    });

    return { provider: 'local' };
  }

  async verifyPhoneWithProvider(
    e164Phone: string,
    otp: string,
    correlationId?: string,
  ): Promise<{ verified: boolean; message: string }> {
    if (!this.msg91.isConfigured()) {
      return { verified: false, message: 'MSG91 is not configured' };
    }
    return this.msg91.verifyOtp({
      e164Phone,
      otp,
      correlationId,
    });
  }

  encodeMsg91Challenge(requestId: string): string {
    return this.msg91.encodeChallengeRef(requestId);
  }

  isMsg91Challenge(otpHash: string): boolean {
    return this.msg91.isProviderChallenge(otpHash);
  }

  async resendPhone(
    e164Phone: string,
    correlationId?: string,
  ): Promise<OtpDeliveryResult> {
    if (!this.msg91.isConfigured()) {
      throw new Msg91ProviderError(
        'MSG91 is not configured for resend',
        'INVALID_AUTHKEY',
      );
    }
    const result = await this.msg91.resendOtp({ e164Phone, correlationId });
    return {
      provider: 'msg91',
      providerRequestId: result.requestId,
    };
  }
}
