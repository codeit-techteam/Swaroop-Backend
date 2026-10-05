export type KycVerificationKind = 'PAN' | 'GST';

/** Normalized result fields. Only these are persisted and shown to users. */
export type KycVerificationDetails = {
  legalName?: string | null;
  tradeName?: string | null;
  gstStatus?: string | null;
  registrationDate?: string | null;
  cancellationDate?: string | null;
  taxpayerType?: string | null;
  constitution?: string | null;
  address?: string | null;
  state?: string | null;
  stateCode?: string | null;
  pincode?: string | null;
  /** PAN linked to the GSTIN as reported by the provider, masked. */
  panMasked?: string | null;
  nameOnPan?: string | null;
  panStatus?: string | null;
  panCategory?: string | null;
};

export type KycProviderOutcome =
  | {
      outcome: 'VERIFIED';
      details: KycVerificationDetails;
      /** Provider transaction id (Surepass `client_id`). */
      referenceId?: string | null;
      /** Raw PAN linked to a GSTIN. Used only for the mismatch check, never persisted. */
      linkedPan?: string | null;
    }
  | {
      outcome: 'FAILED';
      code: string;
      reason: string;
      details?: KycVerificationDetails;
      referenceId?: string | null;
    }
  | {
      /** Provider answered, but the record needs an admin decision. */
      outcome: 'REVIEW';
      code: string;
      reason: string;
      details: KycVerificationDetails;
      referenceId?: string | null;
    }
  | { outcome: 'UNAVAILABLE'; code: string; reason: string }
  | { outcome: 'NOT_CONFIGURED' };

/** Client that initiated a verification or upload. */
export const KYC_VERIFICATION_SOURCES = [
  'CUSTOMER_APP',
  'CUSTOMER_WEB',
  'SELLER_APP',
  'SELLER_WEB',
  'ADMIN',
] as const;

export type KycVerificationSource = (typeof KYC_VERIFICATION_SOURCES)[number];

/** Request metadata recorded with each attempt for the audit trail. */
export type KycRequestMeta = {
  source?: KycVerificationSource | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};
