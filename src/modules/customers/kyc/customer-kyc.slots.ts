import { DocumentCategory } from '../../../generated/prisma/client.js';
import { readChangeRequest } from '../../documents/common/kyc-change-request.js';
import type { KycChangeRequest } from '../../documents/common/kyc-change-request.js';
import { readJsonObject } from '../../sellers/onboarding/onboarding-documents.slots.js';

/** Marks document rows created by the customer KYC flow. */
export const CUSTOMER_KYC_DOCUMENT_PURPOSE = 'CUSTOMER_KYC';

export const CUSTOMER_KYC_UPLOAD_SOURCES = [
  'CUSTOMER_APP',
  'CUSTOMER_WEB',
] as const;

export type CustomerKycUploadSource =
  (typeof CUSTOMER_KYC_UPLOAD_SOURCES)[number];

export const CUSTOMER_KYC_DOCUMENT_SLOTS = [
  {
    slot: 'pan',
    category: DocumentCategory.PAN,
    name: 'PAN Card',
    description: 'Company or proprietor PAN card',
    required: true,
  },
  {
    slot: 'gst',
    category: DocumentCategory.GST,
    name: 'GST Certificate',
    description: 'GST registration certificate',
    required: true,
  },
  {
    slot: 'aadhaar',
    category: DocumentCategory.AADHAAR,
    name: 'Aadhaar',
    description: 'Authorized signatory Aadhaar',
    required: true,
  },
  {
    slot: 'cancelledCheque',
    category: DocumentCategory.BANK,
    name: 'Cancelled Cheque',
    description: 'Cancelled cheque of the business bank account',
    required: false,
  },
] as const;

export type CustomerKycDocumentSlot =
  (typeof CUSTOMER_KYC_DOCUMENT_SLOTS)[number]['slot'];

export const CUSTOMER_KYC_SLOT_VALUES = CUSTOMER_KYC_DOCUMENT_SLOTS.map(
  (item) => item.slot,
);

export function resolveCustomerKycSlot(slot: string) {
  return CUSTOMER_KYC_DOCUMENT_SLOTS.find((item) => item.slot === slot);
}

export function isCustomerKycDocumentMeta(
  meta: Record<string, unknown>,
  slot?: string,
): boolean {
  if (meta.purpose !== CUSTOMER_KYC_DOCUMENT_PURPOSE) return false;
  if (slot && meta.slot !== slot) return false;
  return typeof meta.slot === 'string';
}

export const CUSTOMER_KYC_STATUSES = [
  'NOT_SUBMITTED',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
] as const;

export type CustomerKycStatus = (typeof CUSTOMER_KYC_STATUSES)[number];

/** Stored at CustomerProfile.metadata.kyc. */
export type CustomerKycState = {
  status: CustomerKycStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedById: string | null;
  reviewNotes: string | null;
  rejectedReason: string | null;
  changeRequest: KycChangeRequest | null;
};

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function readCustomerKycState(
  profileMetadata: unknown,
): CustomerKycState {
  const raw = readJsonObject(readJsonObject(profileMetadata).kyc);
  const status = CUSTOMER_KYC_STATUSES.includes(raw.status as CustomerKycStatus)
    ? (raw.status as CustomerKycStatus)
    : 'NOT_SUBMITTED';
  return {
    status,
    submittedAt: optionalString(raw.submittedAt),
    reviewedAt: optionalString(raw.reviewedAt),
    reviewedById: optionalString(raw.reviewedById),
    reviewNotes: optionalString(raw.reviewNotes),
    rejectedReason: optionalString(raw.rejectedReason),
    changeRequest: readChangeRequest(raw.changeRequest),
  };
}

/**
 * Effective "KYC verified" flag shared by every client. Organizations approved
 * before the customer KYC workflow existed count as verified until they submit.
 */
export function isCustomerKycVerified(
  status: CustomerKycStatus,
  organizationVerificationStatus: string | null | undefined,
): boolean {
  if (status === 'APPROVED') return true;
  return (
    status === 'NOT_SUBMITTED' && organizationVerificationStatus === 'APPROVED'
  );
}

/** Merge a KYC state patch back into the profile metadata JSON. */
export function withCustomerKycState(
  profileMetadata: unknown,
  patch: Partial<CustomerKycState>,
): Record<string, unknown> {
  const metadata = readJsonObject(profileMetadata);
  return {
    ...metadata,
    kyc: { ...readCustomerKycState(profileMetadata), ...patch },
  };
}
