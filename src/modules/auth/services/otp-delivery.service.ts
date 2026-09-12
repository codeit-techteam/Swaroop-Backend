import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OtpDeliveryPayload {
  identifier: string;
  identifierType: 'PHONE' | 'EMAIL';
  purpose: string;
  otp: string;
}

/**
 * Provider abstraction for SMS/email OTP delivery.
 * Production providers plug in later; development logs intentionally omit OTP.
 */
@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);

  constructor(private readonly configService: ConfigService) {}

  async send(payload: OtpDeliveryPayload): Promise<void> {
    const env = this.configService.get<string>('app.env');
    // Never log OTP values — even in development.
    this.logger.log(
      `OTP queued for ${payload.identifierType} ${payload.identifier} purpose=${payload.purpose} env=${env}`,
    );
  }
}
