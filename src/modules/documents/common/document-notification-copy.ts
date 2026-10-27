import { DocumentCategory } from '../../../generated/prisma/client.js';
import {
  CUSTOMER_KYC_DOCUMENT_PURPOSE,
  resolveCustomerKycSlot,
} from '../../customers/kyc/customer-kyc.slots.js';
import {
  SELLER_ONBOARDING_DOCUMENT_PURPOSE,
  readJsonObject,
  resolveOnboardingSlot,
} from '../../sellers/onboarding/onboarding-documents.slots.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CATEGORY_LABELS: Record<string, string> = {
  [DocumentCategory.GST]: 'GST certificate',
  [DocumentCategory.PAN]: 'PAN card',
  [DocumentCategory.AADHAAR]: 'Aadhaar card',
  [DocumentCategory.BANK]: 'bank document',
  [DocumentCategory.KYC]: 'KYC document',
  [DocumentCategory.MSME]: 'MSME certificate',
  [DocumentCategory.ISO]: 'ISO certificate',
  [DocumentCategory.COA]: 'certificate of analysis',
  [DocumentCategory.MSDS]: 'safety data sheet',
  [DocumentCategory.SDS]: 'safety data sheet',
  [DocumentCategory.TDS]: 'technical data sheet',
  [DocumentCategory.PRODUCT_TDS]: 'technical data sheet',
  [DocumentCategory.INVOICE]: 'invoice',
  [DocumentCategory.GST_INVOICE]: 'GST invoice',
  [DocumentCategory.PURCHASE_ORDER]: 'purchase order',
  [DocumentCategory.PROFORMA]: 'proforma invoice',
  [DocumentCategory.PAYMENT_PROOF]: 'payment proof',
  [DocumentCategory.CREDIT_APPLICATION]: 'credit application',
  [DocumentCategory.FINANCIAL_STATEMENT]: 'financial statement',
  [DocumentCategory.COMPLIANCE]: 'compliance document',
  [DocumentCategory.QUALITY_CERTIFICATE]: 'quality certificate',
  [DocumentCategory.TEST_CERTIFICATE]: 'test certificate',
  [DocumentCategory.COMPLIANCE_CERTIFICATE]: 'compliance certificate',
  [DocumentCategory.OTHER]: 'document',
};

/** True for camera dumps, WhatsApp exports, UUID-named uploads, etc. */
export function looksLikeRawUploadName(value: string | null | undefined): boolean {
  const name = String(value ?? '').trim();
  if (!name) return true;
  if (UUID_RE.test(name)) return true;
  if (/^[0-9a-f-]{20,}(\.[a-z0-9]+)?$/i.test(name)) return true;
  if (/\.(jpe?g|png|gif|webp|heic|pdf|docx?|xlsx?)$/i.test(name)) return true;
  if (/whatsapp\s*image|screenshot|img_\d+|dsc_?\d+|photo[-_ ]?\d+/i.test(name)) {
    return true;
  }
  return false;
}

type DocumentLike = {
  category: DocumentCategory | string;
  documentNumber?: string | null;
  originalFileName?: string | null;
  fileName?: string | null;
  metadata?: unknown;
};

/**
 * Buyer/seller-facing document label for notifications.
 * Prefer KYC/onboarding slot names and category labels — never raw upload filenames.
 */
export function humanDocumentNotificationLabel(doc: DocumentLike): string {
  const meta = readJsonObject(doc.metadata);
  const slot = typeof meta.slot === 'string' ? meta.slot : null;
  const purpose = typeof meta.purpose === 'string' ? meta.purpose : null;

  if (slot) {
    const slotDef =
      purpose === CUSTOMER_KYC_DOCUMENT_PURPOSE
        ? resolveCustomerKycSlot(slot)
        : purpose === SELLER_ONBOARDING_DOCUMENT_PURPOSE
          ? resolveOnboardingSlot(slot)
          : resolveCustomerKycSlot(slot) ?? resolveOnboardingSlot(slot);
    if (slotDef?.name) return slotDef.name;
  }

  const categoryLabel = CATEGORY_LABELS[String(doc.category)];
  if (categoryLabel) return categoryLabel;

  const documentNumber = doc.documentNumber?.trim();
  if (documentNumber && !looksLikeRawUploadName(documentNumber) && !UUID_RE.test(documentNumber)) {
    return documentNumber;
  }

  return 'document';
}

export function documentApprovedNotificationBody(label: string): string {
  const normalized = label.trim().toLowerCase() === 'document' ? 'document' : label.trim();
  if (normalized === 'document') {
    return 'Your document was verified.';
  }
  // Slot names are already title-ish ("GST Certificate"); keep as provided.
  return `Your ${normalized} was verified.`;
}

export function documentRejectedNotificationBody(label: string, reason: string): string {
  const normalized = label.trim().toLowerCase() === 'document' ? 'document' : label.trim();
  const subject =
    normalized === 'document' ? 'Your document' : `Your ${normalized}`;
  return `${subject} was rejected: ${reason}. Please upload a replacement.`;
}
