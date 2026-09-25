import { DocumentCategory } from '../../../generated/prisma/client.js';

/** Marks rows created by seller onboarding, separate from later bank/KYC uploads. */
export const SELLER_ONBOARDING_DOCUMENT_PURPOSE = 'SELLER_ONBOARDING';

export const SELLER_ONBOARDING_DOCUMENT_SLOTS = [
  {
    slot: 'gst',
    category: DocumentCategory.GST,
    name: 'GST Certificate',
    description: 'Upload GST registration proof',
    required: true,
  },
  {
    slot: 'pan',
    category: DocumentCategory.PAN,
    name: 'PAN Card',
    description: 'Upload company PAN document',
    required: true,
  },
  {
    slot: 'aadhaar',
    category: DocumentCategory.AADHAAR,
    name: 'Aadhaar',
    description: 'Upload authorized person Aadhaar',
    required: true,
  },
  {
    slot: 'cancelledCheque',
    category: DocumentCategory.BANK,
    name: 'Cancelled Cheque',
    description: 'Upload bank account cheque copy',
    required: true,
  },
] as const;

export type SellerOnboardingDocumentSlot =
  (typeof SELLER_ONBOARDING_DOCUMENT_SLOTS)[number]['slot'];

export const SELLER_ONBOARDING_SLOT_VALUES = SELLER_ONBOARDING_DOCUMENT_SLOTS.map(
  (item) => item.slot,
);

export function resolveOnboardingSlot(slot: string) {
  return SELLER_ONBOARDING_DOCUMENT_SLOTS.find((item) => item.slot === slot);
}

export function readJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function isOnboardingDocumentMeta(
  meta: Record<string, unknown>,
  slot?: string,
): boolean {
  if (meta.purpose !== SELLER_ONBOARDING_DOCUMENT_PURPOSE) return false;
  if (slot && meta.slot !== slot) return false;
  return typeof meta.slot === 'string';
}

export function isR2Confirmed(meta: Record<string, unknown>): boolean {
  return meta.r2Confirmed === true;
}
