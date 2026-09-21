import { Injectable } from '@nestjs/common';

export type CreditInsuranceEligibility = {
  configured: boolean;
  eligible: boolean | null;
  reason: string;
};

export type CreditInsuranceCoverage = {
  configured: boolean;
  requested: boolean;
  status: 'UNCONFIGURED' | 'MANUAL_REVIEW';
  reason: string;
};

export interface CreditInsuranceProvider {
  checkEligibility(input: {
    customerProfileId: string;
    requestedLimit?: string;
  }): Promise<CreditInsuranceEligibility>;
  requestCoverage(input: {
    customerProfileId: string;
    coverageAmount?: string;
  }): Promise<CreditInsuranceCoverage>;
  getCoverageStatus(input: {
    customerProfileId: string;
  }): Promise<CreditInsuranceCoverage>;
}

/**
 * MVP provider: no external insurer. Admin records coverage manually.
 * Never invents eligibility or claim outcomes.
 */
@Injectable()
export class ManualCreditInsuranceProvider implements CreditInsuranceProvider {
  async checkEligibility(): Promise<CreditInsuranceEligibility> {
    return {
      configured: false,
      eligible: null,
      reason:
        'External credit insurance provider is not configured. Use admin manual workflow.',
    };
  }

  async requestCoverage(): Promise<CreditInsuranceCoverage> {
    return {
      configured: false,
      requested: false,
      status: 'UNCONFIGURED',
      reason:
        'Coverage cannot be requested automatically. Record insurance on the credit account in Admin.',
    };
  }

  async getCoverageStatus(): Promise<CreditInsuranceCoverage> {
    return {
      configured: false,
      requested: false,
      status: 'UNCONFIGURED',
      reason: 'No external insurance provider is connected.',
    };
  }
}
