import { NewGradeRequestStatus } from '../../generated/prisma/client.js';

/**
 * Statuses in which a request is still being worked on. A customer may only have
 * ONE open request per (grade name + manufacturer) — see `normalizeDedupeKey`.
 */
export const OPEN_GRADE_REQUEST_STATUSES: NewGradeRequestStatus[] = [
  NewGradeRequestStatus.SUBMITTED,
  NewGradeRequestStatus.UNDER_REVIEW,
  NewGradeRequestStatus.INFO_REQUIRED,
  NewGradeRequestStatus.GRADE_IDENTIFIED,
  NewGradeRequestStatus.QUOTATION_AVAILABLE,
];

export const TERMINAL_GRADE_REQUEST_STATUSES: NewGradeRequestStatus[] = [
  NewGradeRequestStatus.CONVERTED_TO_PR,
  NewGradeRequestStatus.REJECTED,
  NewGradeRequestStatus.CLOSED,
];

/** Document types a customer may attach (maps to DocumentCategory of the same name). */
export const GRADE_REQUEST_DOCUMENT_TYPES = [
  'TDS',
  'TECHNICAL_SPECIFICATION',
  'MSDS',
  'COA',
  'OTHER',
] as const;
export type GradeRequestDocumentType =
  (typeof GRADE_REQUEST_DOCUMENT_TYPES)[number];

export const MAX_GRADE_REQUEST_DOCUMENTS = 5;

export const GRADE_REQUEST_UNITS = ['MT', 'KG', 'LTR'] as const;

const S = NewGradeRequestStatus;

/**
 * Admin-driven transitions. CUSTOMER_RESPONDED (INFO_REQUIRED -> UNDER_REVIEW) and
 * customer cancel (-> CLOSED) are applied by the customer service using the same table.
 */
export const GRADE_REQUEST_TRANSITIONS: Record<
  NewGradeRequestStatus,
  NewGradeRequestStatus[]
> = {
  [S.SUBMITTED]: [
    S.UNDER_REVIEW,
    S.INFO_REQUIRED,
    S.GRADE_IDENTIFIED,
    S.REJECTED,
    S.CLOSED,
  ],
  [S.UNDER_REVIEW]: [
    S.INFO_REQUIRED,
    S.GRADE_IDENTIFIED,
    S.QUOTATION_AVAILABLE,
    S.REJECTED,
    S.CLOSED,
  ],
  [S.INFO_REQUIRED]: [S.UNDER_REVIEW, S.REJECTED, S.CLOSED],
  [S.GRADE_IDENTIFIED]: [
    S.UNDER_REVIEW,
    S.QUOTATION_AVAILABLE,
    S.CONVERTED_TO_PR,
    S.CLOSED,
  ],
  [S.QUOTATION_AVAILABLE]: [S.UNDER_REVIEW, S.CONVERTED_TO_PR, S.CLOSED],
  [S.CONVERTED_TO_PR]: [],
  [S.REJECTED]: [],
  [S.CLOSED]: [],
};

export function canTransition(
  from: NewGradeRequestStatus,
  to: NewGradeRequestStatus,
): boolean {
  return GRADE_REQUEST_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses the admin may set through the generic status endpoint. */
export const ADMIN_DIRECT_STATUSES: NewGradeRequestStatus[] = [
  S.UNDER_REVIEW,
  S.QUOTATION_AVAILABLE,
  S.CONVERTED_TO_PR,
  S.REJECTED,
  S.CLOSED,
];

/** These need a reason that is shown to the customer. */
export const STATUSES_REQUIRING_REASON: NewGradeRequestStatus[] = [
  S.REJECTED,
  S.CLOSED,
];

export const GRADE_REQUEST_STATUS_LABELS: Record<
  NewGradeRequestStatus,
  string
> = {
  [S.SUBMITTED]: 'Submitted',
  [S.UNDER_REVIEW]: 'Under Review',
  [S.INFO_REQUIRED]: 'Additional Information Required',
  [S.GRADE_IDENTIFIED]: 'Grade Identified',
  [S.QUOTATION_AVAILABLE]: 'Quotation Available',
  [S.CONVERTED_TO_PR]: 'Converted to Purchase Request',
  [S.REJECTED]: 'Rejected',
  [S.CLOSED]: 'Closed',
};

/** Customer-facing copy for each status (never reveals internal notes). */
export const GRADE_REQUEST_STATUS_DESCRIPTIONS: Record<
  NewGradeRequestStatus,
  string
> = {
  [S.SUBMITTED]: 'We received your request. Our team will review it shortly.',
  [S.UNDER_REVIEW]: 'Our team is reviewing the technical details.',
  [S.INFO_REQUIRED]: 'We need a little more information from you to continue.',
  [S.GRADE_IDENTIFIED]: 'We identified a matching grade for your requirement.',
  [S.QUOTATION_AVAILABLE]: 'A quotation is available for your requirement.',
  [S.CONVERTED_TO_PR]: 'Your request has moved on to a purchase request.',
  [S.REJECTED]: 'We are unable to fulfil this request.',
  [S.CLOSED]: 'This request is closed.',
};

/**
 * Duplicate rule key: lower-cased, whitespace-collapsed grade name + manufacturer.
 * Two requests with the same key from the same customer cannot both be open.
 */
export function normalizeDedupeKey(
  gradeName: string,
  manufacturer?: string | null,
): string {
  const norm = (v?: string | null) =>
    (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${norm(gradeName)}|${norm(manufacturer)}`;
}

export function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function emptyToNull(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const v = collapseSpaces(value);
  return v.length ? v : null;
}

/** Indian mobile: optional +91/91/0 prefix + 10 digits starting 6-9. */
export function normalizeIndianMobile(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, '');
  const m = /^(?:\+?91|0)?([6-9][0-9]{9})$/.exec(digits);
  return m ? `+91${m[1]}` : null;
}

export type GradeRequestEventRow = {
  id: string;
  eventType: string;
  fromStatus: NewGradeRequestStatus | null;
  toStatus: NewGradeRequestStatus | null;
  actorRole: string;
  message: string | null;
  internal: boolean;
  createdAt: Date;
  actorUserId?: string | null;
  metadata?: unknown;
};

/** Customer timeline: no internal notes, no admin identities. */
export function toCustomerTimeline(events: GradeRequestEventRow[]) {
  return events
    .filter((e) => !e.internal)
    .map((e) => ({
      id: e.id,
      type: e.eventType,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      toStatusLabel: e.toStatus
        ? GRADE_REQUEST_STATUS_LABELS[e.toStatus]
        : null,
      actor: e.actorRole === 'CUSTOMER' ? 'YOU' : 'POLYSTOREX',
      message: e.message,
      createdAt: e.createdAt.toISOString(),
    }));
}
