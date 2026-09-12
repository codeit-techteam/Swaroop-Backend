import { PurchaseOrderStatus } from '../../../generated/prisma/client.js';

/**
 * GMV = sum of purchase order totalAmount for commercially confirmed
 * (and later lifecycle) POs. Excludes draft, cancelled, rejected, and
 * pre-confirmation seller-review states.
 */
export const GMV_PO_STATUSES: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.CONFIRMED,
  PurchaseOrderStatus.READY_FOR_DISPATCH,
  PurchaseOrderStatus.DISPATCHED,
  PurchaseOrderStatus.IN_TRANSIT,
  PurchaseOrderStatus.DELIVERED,
  PurchaseOrderStatus.COMPLETED,
];

export const ACTIVE_PO_STATUSES: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.DRAFT,
  PurchaseOrderStatus.SENT_TO_SELLER,
  PurchaseOrderStatus.SELLER_REVIEW,
  PurchaseOrderStatus.CONFIRMED,
  PurchaseOrderStatus.READY_FOR_DISPATCH,
  PurchaseOrderStatus.DISPATCHED,
  PurchaseOrderStatus.IN_TRANSIT,
  PurchaseOrderStatus.DELIVERED,
];

export const COMPLETED_PO_STATUSES: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.COMPLETED,
  PurchaseOrderStatus.DELIVERED,
];

export const CANCELLED_PO_STATUSES: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.CANCELLED,
  PurchaseOrderStatus.REJECTED,
];
