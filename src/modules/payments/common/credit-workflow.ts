import { BadRequestException } from '@nestjs/common';
import {
  CreditApplicationSource,
  CreditApplicationStatus,
  DocumentCategory,
} from '../../../generated/prisma/client.js';

const S = CreditApplicationStatus;

/**
 * Every status change an application may make. Services must go through
 * {@link assertCreditTransition} and write with a compare-and-set on the
 * previous status so concurrent actions cannot both succeed.
 *
 * `→ DRAFT` from a submitted status is "resubmission requested": the
 * application reopens for the customer to edit and submit again.
 */
export const CREDIT_APPLICATION_TRANSITIONS: Record<
  CreditApplicationStatus,
  readonly CreditApplicationStatus[]
> = {
  [S.DRAFT]: [S.PENDING, S.CANCELLED],
  [S.PENDING]: [S.UNDER_REVIEW, S.DOCUMENTS_REQUIRED, S.REJECTED, S.DRAFT],
  [S.DOCUMENTS_UNDER_REVIEW]: [
    S.UNDER_REVIEW,
    S.DOCUMENTS_REQUIRED,
    S.REJECTED,
    S.DRAFT,
  ],
  [S.UNDER_REVIEW]: [
    S.DOCUMENTS_REQUIRED,
    S.INSURANCE_REVIEW,
    S.CREDIT_ARRANGEMENT_PENDING,
    S.APPROVED,
    S.PARTIALLY_APPROVED,
    S.REJECTED,
    S.DRAFT,
  ],
  [S.DOCUMENTS_REQUIRED]: [
    S.DOCUMENTS_UNDER_REVIEW,
    S.UNDER_REVIEW,
    S.REJECTED,
    S.DRAFT,
  ],
  [S.INSURANCE_REVIEW]: [
    S.CREDIT_ARRANGEMENT_PENDING,
    S.APPROVED,
    S.PARTIALLY_APPROVED,
    S.DOCUMENTS_REQUIRED,
    S.REJECTED,
  ],
  [S.CREDIT_ARRANGEMENT_PENDING]: [
    S.APPROVED,
    S.PARTIALLY_APPROVED,
    S.DOCUMENTS_REQUIRED,
    S.REJECTED,
  ],
  [S.APPROVED]: [],
  [S.PARTIALLY_APPROVED]: [],
  [S.REJECTED]: [],
  [S.EXPIRED]: [],
  [S.CANCELLED]: [],
};

export function canTransitionCredit(
  from: CreditApplicationStatus,
  to: CreditApplicationStatus,
): boolean {
  return CREDIT_APPLICATION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertCreditTransition(
  from: CreditApplicationStatus,
  to: CreditApplicationStatus,
): void {
  if (!canTransitionCredit(from, to)) {
    throw new BadRequestException(
      `Credit application cannot move from ${humanizeCreditStatus(from)} to ${humanizeCreditStatus(to)}`,
    );
  }
}

export type CreditAdminAction =
  | 'START_REVIEW'
  | 'REQUEST_DOCUMENTS'
  | 'REQUEST_RESUBMISSION'
  | 'SEND_INSURANCE_REVIEW'
  | 'MARK_ARRANGEMENT_PENDING'
  | 'APPROVE'
  | 'PARTIAL_APPROVE'
  | 'REJECT'
  | 'ASSIGN'
  | 'ADD_REMARK';

/** Admin actions valid for an application in `status`, derived from the transition table. */
export function creditAdminActions(
  status: CreditApplicationStatus,
): CreditAdminAction[] {
  const can = (to: CreditApplicationStatus) => canTransitionCredit(status, to);
  const actions: CreditAdminAction[] = [];
  if (can(S.UNDER_REVIEW)) actions.push('START_REVIEW');
  if (can(S.DOCUMENTS_REQUIRED)) actions.push('REQUEST_DOCUMENTS');
  if (status !== S.DRAFT && can(S.DRAFT)) actions.push('REQUEST_RESUBMISSION');
  if (can(S.INSURANCE_REVIEW)) actions.push('SEND_INSURANCE_REVIEW');
  if (can(S.CREDIT_ARRANGEMENT_PENDING)) {
    actions.push('MARK_ARRANGEMENT_PENDING');
  }
  if (can(S.APPROVED)) actions.push('APPROVE');
  if (can(S.PARTIALLY_APPROVED)) actions.push('PARTIAL_APPROVE');
  if (can(S.REJECTED)) actions.push('REJECT');
  actions.push('ASSIGN', 'ADD_REMARK');
  return actions;
}

/** Statuses an application can be in for the given target to be reachable. */
export function creditStatusesAllowing(
  to: CreditApplicationStatus,
): CreditApplicationStatus[] {
  return (
    Object.keys(CREDIT_APPLICATION_TRANSITIONS) as CreditApplicationStatus[]
  ).filter((from) => canTransitionCredit(from, to));
}

export function humanizeCreditStatus(status: string): string {
  if (status === S.PENDING) return 'Submitted';
  return status
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * A reopened draft (admin requested resubmission) keeps its original
 * `submittedAt`; a never-submitted draft has none.
 */
export function isResubmissionRequested(application: {
  status: CreditApplicationStatus;
  submittedAt: Date | null;
}): boolean {
  return application.status === S.DRAFT && application.submittedAt != null;
}

/** Status shown to people: the stored status plus the derived resubmission state. */
export const RESUBMISSION_REQUIRED_STATUS = 'RESUBMISSION_REQUIRED';

export function creditDisplayStatus(application: {
  status: CreditApplicationStatus;
  submittedAt: Date | null;
}): string {
  return isResubmissionRequested(application)
    ? RESUBMISSION_REQUIRED_STATUS
    : application.status;
}

export const CREDIT_APPLICATION_SOURCE_LABELS: Record<
  CreditApplicationSource,
  string
> = {
  WEBSITE: 'Website',
  CUSTOMER_WEB: 'Customer Web',
  CUSTOMER_APP: 'Customer App',
  SELLER_WEB: 'Seller Web',
  SELLER_APP: 'Seller App',
  ADMIN: 'Admin',
};

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
  RESUBMISSION_REQUESTED: 'CREDIT_RESUBMISSION_REQUESTED',
  ASSIGNED: 'CREDIT_APPLICATION_ASSIGNED',
  REMARK_ADDED: 'CREDIT_ADMIN_REMARK',
} as const;

export type CreditApplicationEventType =
  (typeof CREDIT_APPLICATION_EVENT)[keyof typeof CREDIT_APPLICATION_EVENT];

/** Short, customer-safe hint about what happens next. */
export function creditNextStep(
  status: CreditApplicationStatus,
  opts?: { resubmissionRequested?: boolean },
): string {
  if (status === CreditApplicationStatus.DRAFT && opts?.resubmissionRequested) {
    return 'Our credit team asked for changes. Update your application and submit it again.';
  }
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
