import {
  Prisma,
  Priority,
  ProformaInvoiceStatus,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
} from '../../../generated/prisma/client.js';
import {
  CLOSED_PR_STATUSES,
  SELLER_WINDOW_MS,
  SELLER_WINDOW_STATUSES,
  type WorkbenchBucket,
} from './admin-procurement.signals.js';

const OPEN_PO_STATUSES: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.DRAFT,
  PurchaseOrderStatus.SENT_TO_SELLER,
  PurchaseOrderStatus.SELLER_REVIEW,
  PurchaseOrderStatus.CONFIRMED,
  PurchaseOrderStatus.READY_FOR_DISPATCH,
  PurchaseOrderStatus.DISPATCHED,
  PurchaseOrderStatus.IN_TRANSIT,
  PurchaseOrderStatus.DELIVERED,
];

export function pendingInvoiceWhere(): Prisma.PurchaseRequestWhereInput {
  return {
    status: PurchaseRequestStatus.CONVERTED_TO_ORDER,
    purchaseOrders: {
      some: {
        deletedAt: null,
        OR: [
          { proformaInvoices: { none: { deletedAt: null } } },
          {
            proformaInvoices: {
              some: {
                deletedAt: null,
                status: {
                  in: [
                    ProformaInvoiceStatus.DRAFT,
                    ProformaInvoiceStatus.EXPIRED,
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };
}

export function needsActionWhere(now: Date): Prisma.PurchaseRequestWhereInput {
  const soon = new Date(now.getTime() + SELLER_WINDOW_MS);
  return {
    OR: [
      {
        status: {
          in: [
            PurchaseRequestStatus.PENDING_APPROVAL,
            PurchaseRequestStatus.UNDER_REVIEW,
            PurchaseRequestStatus.NEGOTIATION,
          ],
        },
      },
      {
        status: { in: SELLER_WINDOW_STATUSES },
        responseDeadline: { lte: soon },
      },
      {
        status: {
          in: [
            PurchaseRequestStatus.SUBMITTED,
            PurchaseRequestStatus.SOURCING,
            PurchaseRequestStatus.OFFER_RECEIVED,
          ],
        },
        sellerRespondedAt: null,
      },
      pendingInvoiceWhere(),
      {
        priority: Priority.URGENT,
        status: { notIn: CLOSED_PR_STATUSES },
      },
    ],
  };
}

export function urgentWhere(now: Date): Prisma.PurchaseRequestWhereInput {
  const soon = new Date(now.getTime() + SELLER_WINDOW_MS);
  return {
    OR: [
      {
        priority: Priority.URGENT,
        status: { notIn: CLOSED_PR_STATUSES },
      },
      {
        status: { in: SELLER_WINDOW_STATUSES },
        responseDeadline: { lte: soon },
      },
      {
        status: PurchaseRequestStatus.CONVERTED_TO_ORDER,
        purchaseOrders: {
          some: {
            deletedAt: null,
            proformaInvoices: {
              some: {
                deletedAt: null,
                status: ProformaInvoiceStatus.EXPIRED,
              },
            },
          },
        },
      },
    ],
  };
}

export function bucketWhere(
  bucket: WorkbenchBucket | undefined,
  now: Date,
): Prisma.PurchaseRequestWhereInput | null {
  switch (bucket) {
    case undefined:
    case 'all':
      return null;
    case 'needs_action':
      return needsActionWhere(now);
    case 'negotiation':
      return { status: PurchaseRequestStatus.NEGOTIATION };
    case 'urgent':
      return urgentWhere(now);
    case 'pending_invoice':
      return pendingInvoiceWhere();
    case 'approved':
      return {
        status: {
          in: [
            PurchaseRequestStatus.APPROVED,
            PurchaseRequestStatus.CONVERTED_TO_ORDER,
          ],
        },
      };
    case 'pending_approvals':
      return { status: PurchaseRequestStatus.PENDING_APPROVAL };
    case 'pending_seller':
      return {
        status: {
          in: [
            PurchaseRequestStatus.SUBMITTED,
            PurchaseRequestStatus.SOURCING,
            PurchaseRequestStatus.OFFER_RECEIVED,
          ],
        },
        sellerRespondedAt: null,
      };
    case 'open_po':
      return {
        purchaseOrders: {
          some: { deletedAt: null, status: { in: OPEN_PO_STATUSES } },
        },
      };
    default:
      return null;
  }
}

export const OPEN_PURCHASE_ORDER_STATUSES = OPEN_PO_STATUSES;
