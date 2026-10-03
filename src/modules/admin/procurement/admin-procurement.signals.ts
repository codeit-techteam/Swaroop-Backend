import {
  Priority,
  ProformaInvoiceStatus,
  PurchaseRequestStatus,
} from '../../../generated/prisma/client.js';

export const SELLER_WINDOW_MS = 15 * 60 * 1000;

export const SELLER_WINDOW_STATUSES: PurchaseRequestStatus[] = [
  PurchaseRequestStatus.SUBMITTED,
  PurchaseRequestStatus.SOURCING,
  PurchaseRequestStatus.OFFER_RECEIVED,
  PurchaseRequestStatus.NEGOTIATION,
];

export const CLOSED_PR_STATUSES: PurchaseRequestStatus[] = [
  PurchaseRequestStatus.REJECTED,
  PurchaseRequestStatus.EXPIRED,
  PurchaseRequestStatus.CANCELLED,
  PurchaseRequestStatus.WITHDRAWN,
];

export const WORKBENCH_BUCKETS = [
  'all',
  'needs_action',
  'negotiation',
  'urgent',
  'pending_invoice',
  'approved',
  'pending_approvals',
  'pending_seller',
  'open_po',
] as const;

export type WorkbenchBucket = (typeof WORKBENCH_BUCKETS)[number];

export type ProcurementActionType =
  | 'ADMIN_APPROVAL_PENDING'
  | 'ADMIN_REVIEW'
  | 'SELLER_RESPONSE_PENDING'
  | 'SELLER_RESPONSE_EXPIRED'
  | 'COUNTER_OFFER_AWAITING'
  | 'PI_NOT_GENERATED'
  | 'PAYMENT_ISSUE'
  | 'PO_MISSING';

export interface ProcurementSignals {
  status: PurchaseRequestStatus;
  priority: Priority;
  responseDeadline: Date | null;
  sellerRespondedAt: Date | null;
  hasPurchaseOrder: boolean;
  piStatus: ProformaInvoiceStatus | null;
  piDueDate: Date | null;
  piRemainingAmount: string | null;
}

export interface ProcurementAction {
  actionRequired: boolean;
  actionType: ProcurementActionType | null;
  actionReason: string | null;
  urgent: boolean;
  deadlineLabel: string | null;
}

const STATUS_LABELS: Record<PurchaseRequestStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  SOURCING: 'Pending Seller Response',
  OFFER_RECEIVED: 'Offer Received',
  NEGOTIATION: 'Negotiation',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Commercial Accepted',
  REJECTED: 'Rejected',
  CONVERTED_TO_ORDER: 'Purchase Order Issued',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  WITHDRAWN: 'Withdrawn',
};

const PO_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SENT_TO_SELLER: 'Sent to Seller',
  SELLER_REVIEW: 'Seller Review',
  CONFIRMED: 'Issued',
  READY_FOR_DISPATCH: 'Ready for Dispatch',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In Transit',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
};

const PI_LABELS: Record<string, string> = {
  DRAFT: 'Not Generated',
  ISSUED: 'Generated',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Overdue',
};

const EVENT_MESSAGES: Record<string, string> = {
  PURCHASE_REQUEST_CREATED: 'Purchase request created',
  SELLER_MATCHED: 'Seller matched',
  SENT_TO_SELLER: 'Sent to seller',
  PURCHASE_REQUEST_VIEWED_BY_SELLER: 'Seller viewed the request',
  SELLER_ACCEPTED: 'Seller accepted',
  SELLER_REJECTED: 'Seller rejected',
  SELLER_COUNTER_OFFERED: 'Counter offer received',
  CUSTOMER_COUNTER_OFFERED: 'Customer counter offer sent',
  COUNTER_ACCEPTED: 'Counter offer accepted',
  COUNTER_REJECTED: 'Counter offer rejected',
  RESPONSE_WINDOW_WARNING: 'Seller response window closing',
  PURCHASE_REQUEST_EXPIRED: 'Purchase request expired',
  PURCHASE_REQUEST_CANCELLED: 'Purchase request cancelled',
  COMMERCIAL_TERMS_ACCEPTED: 'Commercial terms accepted',
  PURCHASE_ORDER_CREATED: 'Purchase order created',
  ADMIN_NOTE_ADDED: 'Admin note added',
  ADMIN_MARKED_FOR_REVIEW: 'Marked for admin review',
  ADMIN_ESCALATED: 'Priority escalated',
  PROCUREMENT_VIEWED: 'Procurement opened by admin',
};

export function purchaseRequestStatusLabel(status: string) {
  return STATUS_LABELS[status as PurchaseRequestStatus] ?? status;
}

export function purchaseOrderStatusLabel(status: string | null | undefined) {
  if (!status) return 'Not created';
  return PO_LABELS[status] ?? status;
}

export function proformaStatusLabel(status: string | null | undefined) {
  if (!status) return 'Not Generated';
  return PI_LABELS[status] ?? status;
}

export function paymentStatusLabel(input: {
  piStatus: string | null | undefined;
  piRemainingAmount: string | null | undefined;
}) {
  if (!input.piStatus || input.piStatus === 'DRAFT') return 'Awaiting Invoice';
  if (input.piStatus === 'PAID') return 'Paid';
  if (input.piStatus === 'PARTIALLY_PAID') return 'Partially Paid';
  if (input.piStatus === 'EXPIRED') return 'Overdue';
  if (input.piStatus === 'CANCELLED') return 'Cancelled';
  if (input.piRemainingAmount && Number(input.piRemainingAmount) > 0) {
    return 'Payment Required';
  }
  return 'Payment Required';
}

export function activityMessage(eventType: string, referenceNumber: string) {
  const label =
    EVENT_MESSAGES[eventType] ?? eventType.replaceAll('_', ' ').toLowerCase();
  return `${label} · ${referenceNumber}`;
}

export function deadlineLabel(deadline: Date, now: Date) {
  const delta = deadline.getTime() - now.getTime();
  const minutes = Math.max(1, Math.round(Math.abs(delta) / 60_000));
  if (delta >= 0) {
    if (minutes < 60) return `${minutes}m remaining`;
    const hours = Math.max(1, Math.round(minutes / 60));
    return `${hours}h remaining`;
  }
  if (minutes < 60) return `Expired ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Expired ${hours}h ago`;
  const days = Math.max(1, Math.round(hours / 24));
  return `Expired ${days}d ago`;
}

function remainingPositive(amount: string | null) {
  if (!amount) return false;
  const normalized = amount.trim();
  if (!normalized || normalized === '0' || normalized === '0.00') return false;
  return !normalized.startsWith('-');
}

export function deriveProcurementAction(
  input: ProcurementSignals,
  now: Date,
): ProcurementAction {
  const closed = CLOSED_PR_STATUSES.includes(input.status);
  if (closed) {
    return {
      actionRequired: false,
      actionType: null,
      actionReason: null,
      urgent: false,
      deadlineLabel: null,
    };
  }

  const inSellerWindow = SELLER_WINDOW_STATUSES.includes(input.status);
  const label =
    input.responseDeadline && inSellerWindow
      ? deadlineLabel(input.responseDeadline, now)
      : null;
  const deadlineMs = input.responseDeadline
    ? input.responseDeadline.getTime() - now.getTime()
    : null;
  const deadlineExpired = deadlineMs != null && deadlineMs < 0;
  const deadlineSoon =
    deadlineMs != null && deadlineMs >= 0 && deadlineMs <= SELLER_WINDOW_MS;
  const priorityUrgent = input.priority === Priority.URGENT;

  let action: ProcurementAction = {
    actionRequired: false,
    actionType: null,
    actionReason: null,
    urgent:
      priorityUrgent || (inSellerWindow && (deadlineExpired || deadlineSoon)),
    deadlineLabel: label,
  };

  if (input.status === PurchaseRequestStatus.CONVERTED_TO_ORDER) {
    if (!input.hasPurchaseOrder) {
      action = {
        ...action,
        actionRequired: true,
        actionType: 'PO_MISSING',
        actionReason: 'Commercial acceptance recorded without a purchase order',
        urgent: true,
      };
    } else if (
      input.piStatus === ProformaInvoiceStatus.EXPIRED ||
      (input.piDueDate != null &&
        input.piDueDate.getTime() < now.getTime() &&
        input.piStatus !== ProformaInvoiceStatus.PAID &&
        input.piStatus !== ProformaInvoiceStatus.CANCELLED &&
        remainingPositive(input.piRemainingAmount))
    ) {
      action = {
        ...action,
        actionRequired: true,
        actionType: 'PAYMENT_ISSUE',
        actionReason: 'Proforma invoice is overdue',
        urgent: true,
      };
    } else if (
      !input.piStatus ||
      input.piStatus === ProformaInvoiceStatus.DRAFT
    ) {
      action = {
        ...action,
        actionRequired: true,
        actionType: 'PI_NOT_GENERATED',
        actionReason: 'Proforma invoice has not been issued',
      };
    }
    return action;
  }

  if (input.status === PurchaseRequestStatus.PENDING_APPROVAL) {
    return {
      ...action,
      actionRequired: true,
      actionType: 'ADMIN_APPROVAL_PENDING',
      actionReason: 'Waiting on admin approval',
    };
  }

  if (input.status === PurchaseRequestStatus.UNDER_REVIEW) {
    return {
      ...action,
      actionRequired: true,
      actionType: 'ADMIN_REVIEW',
      actionReason: 'Marked for admin review',
    };
  }

  if (inSellerWindow && deadlineExpired) {
    return {
      ...action,
      actionRequired: true,
      actionType: 'SELLER_RESPONSE_EXPIRED',
      actionReason: label,
      urgent: true,
    };
  }

  if (
    (input.status === PurchaseRequestStatus.SUBMITTED ||
      input.status === PurchaseRequestStatus.SOURCING ||
      input.status === PurchaseRequestStatus.OFFER_RECEIVED) &&
    !input.sellerRespondedAt
  ) {
    return {
      ...action,
      actionRequired: true,
      actionType: 'SELLER_RESPONSE_PENDING',
      actionReason: label ?? 'Waiting for the seller to respond',
      urgent: action.urgent || deadlineSoon,
    };
  }

  if (input.status === PurchaseRequestStatus.NEGOTIATION) {
    return {
      ...action,
      actionRequired: true,
      actionType: 'COUNTER_OFFER_AWAITING',
      actionReason: label ?? 'Negotiation in progress',
    };
  }

  return action;
}

export function csvCell(value: string | number | null | undefined) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
