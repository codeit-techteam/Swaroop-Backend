import {
  CreditApplicationStatus,
  DocumentCategory,
} from '../../../generated/prisma/client.js';

/** Statuses where an application is still in flight and blocks a new one. */
export const OPEN_CREDIT_APPLICATION_STATUSES: CreditApplicationStatus[] = [
  CreditApplicationStatus.DRAFT,
  CreditApplicationStatus.PENDING,
  CreditApplicationStatus.DOCUMENTS_UNDER_REVIEW,
  CreditApplicationStatus.UNDER_REVIEW,
  CreditApplicationStatus.DOCUMENTS_REQUIRED,
  CreditApplicationStatus.INSURANCE_REVIEW,
  CreditApplicationStatus.CREDIT_ARRANGEMENT_PENDING,
];

/** Statuses an admin can still act on. */
export const ACTIONABLE_CREDIT_APPLICATION_STATUSES: CreditApplicationStatus[] =
  [
    CreditApplicationStatus.PENDING,
    CreditApplicationStatus.DOCUMENTS_UNDER_REVIEW,
    CreditApplicationStatus.UNDER_REVIEW,
    CreditApplicationStatus.DOCUMENTS_REQUIRED,
    CreditApplicationStatus.INSURANCE_REVIEW,
    CreditApplicationStatus.CREDIT_ARRANGEMENT_PENDING,
  ];

/** Terminal statuses that can no longer be decided on. */
export const TERMINAL_CREDIT_APPLICATION_STATUSES: CreditApplicationStatus[] = [
  CreditApplicationStatus.APPROVED,
  CreditApplicationStatus.PARTIALLY_APPROVED,
  CreditApplicationStatus.REJECTED,
  CreditApplicationStatus.EXPIRED,
  CreditApplicationStatus.CANCELLED,
];

/** Statuses where the customer may still attach or replace documents. */
export const CREDIT_DOCUMENT_UPLOAD_STATUSES: CreditApplicationStatus[] = [
  CreditApplicationStatus.DRAFT,
  CreditApplicationStatus.DOCUMENTS_REQUIRED,
  CreditApplicationStatus.PENDING,
];

export const CREDIT_APPLICATION_DOCUMENT_TYPES = [
  'gst_registration',
  'gst_returns',
  'bank_statement',
  'itr_financials',
  'cancelled_cheque',
  'business_registration',
  'other',
] as const;

export type CreditApplicationDocumentType =
  (typeof CREDIT_APPLICATION_DOCUMENT_TYPES)[number];

/** Documents a customer must attach before the application can be submitted. */
export const REQUIRED_CREDIT_DOCUMENT_TYPES: CreditApplicationDocumentType[] = [
  'gst_registration',
  'bank_statement',
  'itr_financials',
];

export const CREDIT_DOCUMENT_TYPE_LABELS: Record<
  CreditApplicationDocumentType,
  string
> = {
  gst_registration: 'GST Registration Certificate',
  gst_returns: 'GST Returns',
  bank_statement: 'Bank Statement',
  itr_financials: 'ITR / Financial Statements',
  cancelled_cheque: 'Cancelled Cheque',
  business_registration: 'Business Registration',
  other: 'Supporting Document',
};

/**
 * Document categories the customer-facing credit flow may write to.
 * Keep in sync with CREDIT_DOC_CATEGORIES on the admin side.
 */
export function creditDocumentCategory(documentType: string): DocumentCategory {
  if (documentType.startsWith('gst_')) return DocumentCategory.GST;
  if (documentType.startsWith('bank_') || documentType === 'cancelled_cheque') {
    return DocumentCategory.BANK;
  }
  if (documentType === 'itr_financials') {
    return DocumentCategory.FINANCIAL_STATEMENT;
  }
  if (documentType === 'business_registration') return DocumentCategory.KYC;
  return DocumentCategory.CREDIT_APPLICATION;
}

export const CREDIT_APPLICATION_EVENT = {
  CREATED: 'CREDIT_APPLICATION_CREATED',
  SUBMITTED: 'CREDIT_APPLICATION_SUBMITTED',
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  DOCUMENT_VERIFIED: 'DOCUMENT_VERIFIED',
  DOCUMENT_REJECTED: 'DOCUMENT_REJECTED',
  ADDITIONAL_DOCUMENTS_REQUESTED: 'ADDITIONAL_DOCUMENTS_REQUESTED',
  DOCUMENTS_RESUBMITTED: 'DOCUMENTS_RESUBMITTED',
  REVIEW_STARTED: 'CREDIT_REVIEW_STARTED',
  INSURANCE_REVIEW_STARTED: 'INSURANCE_REVIEW_STARTED',
  ARRANGEMENT_PENDING: 'CREDIT_ARRANGEMENT_PENDING',
  APPROVED: 'CREDIT_APPROVED',
  PARTIALLY_APPROVED: 'CREDIT_PARTIALLY_APPROVED',
  REJECTED: 'CREDIT_REJECTED',
} as const;

export type CreditApplicationEventType =
  (typeof CREDIT_APPLICATION_EVENT)[keyof typeof CREDIT_APPLICATION_EVENT];

/** Short, customer-safe hint about what happens next. */
export function creditNextStep(status: CreditApplicationStatus): string {
  switch (status) {
    case CreditApplicationStatus.DRAFT:
      return 'Upload the required documents and submit your application.';
    case CreditApplicationStatus.PENDING:
      return 'Your application is queued for review by PetroTrade Credit Management.';
    case CreditApplicationStatus.DOCUMENTS_UNDER_REVIEW:
      return 'Your documents are being verified.';
    case CreditApplicationStatus.UNDER_REVIEW:
      return 'Your application is under credit review.';
    case CreditApplicationStatus.DOCUMENTS_REQUIRED:
      return 'Additional documents are required. Upload them and resubmit.';
    case CreditApplicationStatus.INSURANCE_REVIEW:
      return 'Your application is with our credit insurance partner.';
    case CreditApplicationStatus.CREDIT_ARRANGEMENT_PENDING:
      return 'Credit arrangement is being finalised.';
    case CreditApplicationStatus.APPROVED:
    case CreditApplicationStatus.PARTIALLY_APPROVED:
      return 'Your credit line is active and available at checkout.';
    case CreditApplicationStatus.REJECTED:
      return 'Your application was not approved. You may reapply later.';
    case CreditApplicationStatus.EXPIRED:
      return 'This application has expired. Start a new application.';
    case CreditApplicationStatus.CANCELLED:
      return 'This application was cancelled.';
    default:
      return 'No action required.';
  }
}
