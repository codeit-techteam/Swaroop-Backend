import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Msg91OtpClient } from './msg91-otp.client.js';

export interface OtpDeliveryPayload {
  identifier: string;
  identifierType: 'PHONE' | 'EMAIL';
  purpose: string;
  /** Present only for local/dev OTP delivery — never for MSG91 provider flow. */
  otp?: string;
}

export type OtpDeliveryResult = {
  provider: 'msg91' | 'local' | 'none';
  /** MSG91 request_id when provider is msg91. */
  providerRequestId?: string;
};

/**
 * Provider abstraction for SMS/email OTP delivery.
 * Production phone OTP uses MSG91 when OTP_PROVIDER=msg91 and credentials are set.
 * Development logs intentionally omit OTP values.
 */
@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly msg91: Msg91OtpClient,
  ) {}

  /**
   * True when phone OTPs must be sent and verified through MSG91.
   */
  isMsg91PhoneProvider(): boolean {
    return this.msg91.isConfigured();
  }

  async send(payload: OtpDeliveryPayload): Promise<OtpDeliveryResult> {
    const env = this.configService.get<string>('app.env');

    if (payload.identifierType === 'PHONE' && this.msg91.isConfigured()) {
      const otpLength =
        this.configService.get<number>('security.otpLength') ?? 6;
      const expiresIn =
        this.configService.get<number>('security.otpExpiresInSeconds') ?? 300;

      const result = await this.msg91.sendOtp({
        e164Phone: payload.identifier,
        otpLength,
        expiresInSeconds: expiresIn,
      });

      return {
        provider: 'msg91',
        providerRequestId: result.requestId,
      };
    }

    if (payload.identifierType === 'PHONE') {
      const requireProvider =
        this.configService.get<boolean>('otp.requireProviderInProduction') ===
          true ||
        this.configService.get<boolean>('security.authStrictOtp') === true;

      if (requireProvider) {
        this.logger.error(
          'Phone OTP delivery refused: MSG91 is not configured while strict/production OTP is required',
        );
        throw new Error(
          'OTP SMS provider is not configured. Set MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID.',
        );
      }
    }

    // Local / email stub — never log OTP values.
    this.logger.log(
      `OTP queued for ${payload.identifierType} ${payload.identifier} purpose=${payload.purpose} env=${env} provider=local`,
    );

    return { provider: payload.otp ? 'local' : 'none' };
  }

  async verifyPhoneWithProvider(
    e164Phone: string,
    otp: string,
  ): Promise<{ verified: boolean; message: string }> {
    if (!this.msg91.isConfigured()) {
      return { verified: false, message: 'MSG91 is not configured' };
    }
    return this.msg91.verifyOtp({ e164Phone, otp });
  }

  encodeMsg91Challenge(requestId: string): string {
    return this.msg91.encodeChallengeRef(requestId);
  }

  isMsg91Challenge(otpHash: string): boolean {
    return this.msg91.isProviderChallenge(otpHash);
  }

  async resendPhone(e164Phone: string): Promise<OtpDeliveryResult> {
    if (!this.msg91.isConfigured()) {
      throw new Error('MSG91 is not configured for resend');
    }
    const result = await this.msg91.resendOtp({ e164Phone });
    return {
      provider: 'msg91',
      providerRequestId: result.requestId,
    };
  }
}
