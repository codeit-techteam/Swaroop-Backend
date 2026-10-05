import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/index.js';
import {
  HttpKycVerificationProvider,
  KycVerificationProvider,
} from './kyc-verification.provider.js';
import { KycVerificationService } from './kyc-verification.service.js';
import { SurepassVerificationProvider } from './surepass-verification.provider.js';

/** Shared PAN / GSTIN verification used by customer KYC, seller onboarding and admin review. */
@Module({
  imports: [NotificationsModule],
  providers: [
    SurepassVerificationProvider,
    HttpKycVerificationProvider,
    KycVerificationProvider,
    KycVerificationService,
  ],
  exports: [KycVerificationProvider, KycVerificationService],
})
export class KycVerificationModule {}
