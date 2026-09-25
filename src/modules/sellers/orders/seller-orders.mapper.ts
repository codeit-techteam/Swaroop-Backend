import { createHash } from 'node:crypto';
import type {
  DeliveryStatus,
  DispatchStatus,
  PaymentMethod,
  PaymentStatus,
  PurchaseOrderStatus,
  ShipmentStatus,
} from '../../../generated/prisma/client.js';
import { toDecimal } from '../../payments/common/money.util.js';
import { paymentOptionLabel } from '../../customers/orders/customer-orders.progress.js';
import { BLIND_BUYER_DISPLAY_NAME } from '../common/blind-buyer.js';
import type { SellerOrderDisplayStatus } from './seller-orders.dto.js';

type CommercialSnapshot = {
  gradeId?: string | null;
  productId?: string | null;
  offerId?: string | null;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  totalValue?: number;
  paymentMethod?: PaymentMethod | null;
};

type PoItemSource = {
  gradeId?: string | null;
  productId?: string | null;
  quantity?: unknown;
  unit?: string | null;
  unitPriceSnapshot?: unknown;
  targetUnitPrice?: unknown;
  grade?: {
    id: string;
    code: string;
    name: string;
    displayName: string | null;
  } | null;
  product?: {
    id: string;
    code: string;
    name: string;
  } | null;
};

export type SellerPurchaseOrderSource = {
  id: string;
  referenceNumber: string;
  purchaseRequestId: string | null;
  customerOrgId: string;
  status: PurchaseOrderStatus;
  currency: string;
  subtotal: unknown;
  taxAmount: unknown;
  totalAmount: unknown;
  paymentMethod: PaymentMethod | null;
  orderedQuantity: unknown;
  dispatchedQuantity: unknown;
  deliveredQuantity: unknown;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  metadata: unknown;
  purchaseRequest?: {
    id: string;
    referenceNumber: string;
    status: string;
    destinationRegion?: string | null;
    deliveryLocation?: string | null;
    requiredByDate?: Date | null;
    items?: PoItemSource[];
    events?: Array<{
      id: string;
      eventType: string;
      createdAt: Date;
      metadata?: unknown;
    }>;
  } | null;
  payments?: Array<{
    id: string;
    referenceNumber: string;
    status: PaymentStatus | string;
    amount: unknown;
    verifiedAt: Date | null;
    createdAt: Date;
  }>;
  proformaInvoices?: Array<{
    id: string;
    piNumber: string;
    status: string;
    totalAmount: unknown;
    createdAt: Date;
  }>;
  paymentSchedules?: Array<{
    id: string;
    sequence: number;
    status: string;
    amount: unknown;
    dueAt?: Date | null;
  }>;
  dispatches?: Array<{
    id: string;
    dispatchNumber: string;
    status: DispatchStatus | string;
    plannedDispatchDate?: Date | null;
    actualDispatchDate?: Date | null;
    destinationRegion?: string | null;
    createdAt: Date;
  }>;
  shipments?: Array<{
    id: string;
    referenceNumber?: string | null;
    status: ShipmentStatus | string;
    eta?: Date | null;
    createdAt: Date;
  }>;
  deliveries?: Array<{
    id: string;
    status: DeliveryStatus | string;
    deliveredAt?: Date | null;
    createdAt: Date;
  }>;
};

function money(value: unknown): string {
  return toDecimal(value as never).toFixed(2);
}

function qty(value: unknown): number {
  return Number(toDecimal(value as never).toFixed(3));
}

function anonymousBuyer(customerOrgId: string) {
  return {
    displayName: BLIND_BUYER_DISPLAY_NAME,
    reference: `BUYER-${createHash('sha256')
      .update(customerOrgId)
      .digest('hex')
      .slice(0, 8)
      .toUpperCase()}`,
  };
}

function maskDeliveryRegion(
  destinationRegion?: string | null,
  deliveryLocation?: string | null,
  dispatchRegion?: string | null,
): string {
  if (destinationRegion?.trim()) return destinationRegion.trim();
  if (dispatchRegion?.trim()) return dispatchRegion.trim();
  if (deliveryLocation?.trim()) {
    const value = deliveryLocation.trim();
    if (value.length > 40) return `${value.slice(0, 24)}…`;
    return value;
  }
  return 'Assigned Destination';
}

function isPaymentCleared(status?: string | null): boolean {
  const pay = (status ?? '').toUpperCase();
  return (
    pay === 'VERIFIED' ||
    pay === 'PAID' ||
    pay === 'PARTIALLY_PAID' ||
    pay === 'AUTHORIZED'
  );
}

function isDelivered(po: SellerPurchaseOrderSource): boolean {
  if (po.status === 'DELIVERED' || po.status === 'COMPLETED') {
    return true;
  }
  const delivery = (po.deliveries?.[0]?.status ?? '').toUpperCase();
  const shipment = (po.shipments?.[0]?.status ?? '').toUpperCase();
  return (
    delivery === 'DELIVERED' ||
    delivery === 'CONFIRMED' ||
    shipment === 'DELIVERED' ||
    shipment === 'DELIVERY_CONFIRMED'
  );
}

/**
 * Map canonical PurchaseOrder (+ logistics/payment) to seller UI display status.
 * Does not mutate database status.
 */
export function toSellerDisplayStatus(
  po: SellerPurchaseOrderSource,
): SellerOrderDisplayStatus {
  if (po.status === 'CANCELLED' || po.status === 'REJECTED') {
    return 'CANCELLED';
  }
  if (isDelivered(po)) {
    return 'DELIVERED';
  }

  const shipment = (po.shipments?.[0]?.status ?? '').toUpperCase();
  const dispatch = (po.dispatches?.[0]?.status ?? '').toUpperCase();

  if (
    po.status === 'DISPATCHED' ||
    po.status === 'IN_TRANSIT' ||
    dispatch === 'DISPATCHED' ||
    shipment === 'DISPATCHED' ||
    shipment === 'IN_TRANSIT' ||
    shipment === 'OUT_FOR_DELIVERY'
  ) {
    return 'DISPATCHED';
  }

  if (
    po.status === 'READY_FOR_DISPATCH' ||
    dispatch === 'READY_FOR_DISPATCH' ||
    dispatch === 'LOADED' ||
    shipment === 'READY_TO_DISPATCH'
  ) {
    return 'READY_FOR_DISPATCH';
  }

  const paymentStatus = po.payments?.[0]?.status
    ? String(po.payments[0].status)
    : null;
  const hasPi = (po.proformaInvoices?.length ?? 0) > 0;
  if (
    po.status === 'CONFIRMED' &&
    (hasPi || paymentStatus) &&
    !isPaymentCleared(paymentStatus)
  ) {
    return 'PROCESSING';
  }

  if (
    po.status === 'CONFIRMED' &&
    isPaymentCleared(paymentStatus) &&
    !po.dispatches?.length
  ) {
    return 'PROCESSING';
  }

  return 'CONFIRMED';
}

/** PO statuses included when filtering by a seller display status. */
export function poStatusesForDisplayFilter(
  display: SellerOrderDisplayStatus,
): PurchaseOrderStatus[] | null {
  switch (display) {
    case 'CONFIRMED':
      return ['DRAFT', 'SENT_TO_SELLER', 'SELLER_REVIEW', 'CONFIRMED'];
    case 'PROCESSING':
      // Narrowed further in service after load; DB prefilter.
      return ['CONFIRMED'];
    case 'READY_FOR_DISPATCH':
      return ['READY_FOR_DISPATCH'];
    case 'DISPATCHED':
      return ['DISPATCHED', 'IN_TRANSIT'];
    case 'DELIVERED':
      return ['DELIVERED', 'COMPLETED'];
    case 'CANCELLED':
      return ['CANCELLED', 'REJECTED'];
    default:
      return null;
  }
}

function resolveLine(po: SellerPurchaseOrderSource) {
  const snapshot = (
    po.metadata as { commercialSnapshot?: CommercialSnapshot } | null
  )?.commercialSnapshot;
  const item = po.purchaseRequest?.items?.[0];

  const quantity = qty(
    item?.quantity ?? snapshot?.quantity ?? po.orderedQuantity ?? 0,
  );
  const unitPrice = Number(
    toDecimal(
      (item?.unitPriceSnapshot as never) ??
        (item?.targetUnitPrice as never) ??
        snapshot?.unitPrice ??
        0,
    ).toFixed(4),
  );
  const unit = item?.unit ?? snapshot?.unit ?? 'MT';
  const grade = item?.grade
    ? {
        id: item.grade.id,
        code: item.grade.code,
        name: item.grade.displayName ?? item.grade.name,
      }
    : snapshot?.gradeId
      ? { id: snapshot.gradeId, code: null as string | null, name: '—' }
      : null;
  const product = item?.product
    ? {
        id: item.product.id,
        code: item.product.code,
        name: item.product.name,
      }
    : snapshot?.productId
      ? {
          id: snapshot.productId,
          code: null as string | null,
          name: 'Material',
        }
      : null;

  return {
    quantity,
    unit,
    unitPrice,
    grade,
    product,
    gradeName: grade?.name ?? '—',
    productName: product?.name ?? 'Material',
  };
}

export function toSellerOrderListDto(po: SellerPurchaseOrderSource) {
  const line = resolveLine(po);
  const displayStatus = toSellerDisplayStatus(po);
  const buyer = anonymousBuyer(po.customerOrgId);
  const dispatch = po.dispatches?.[0];
  const expectedDispatchDate =
    dispatch?.plannedDispatchDate?.toISOString() ?? null;

  return {
    id: po.id,
    poNumber: po.referenceNumber,
    orderNumber: po.referenceNumber,
    referenceNumber: po.referenceNumber,
    purchaseOrderId: po.id,
    purchaseRequestId: po.purchaseRequestId,
    status: displayStatus,
    backendStatus: po.status,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice.toFixed(4),
    grade: line.grade,
    product: line.product,
    gradeName: line.gradeName,
    productName: line.productName,
    orderValue: money(po.totalAmount),
    currency: po.currency,
    buyer: {
      displayName: buyer.displayName,
      reference: buyer.reference,
    },
    deliveryRegion: maskDeliveryRegion(
      po.purchaseRequest?.destinationRegion,
      null,
      dispatch?.destinationRegion,
    ),
    expectedDispatchDate,
    expectedDispatchLabel: expectedDispatchDate ? undefined : 'Not scheduled',
    paymentMethod: po.paymentMethod,
    paymentStatus: po.payments?.[0]?.status
      ? String(po.payments[0].status)
      : null,
    dispatchStatus: dispatch?.status ? String(dispatch.status) : null,
    shipmentStatus: po.shipments?.[0]?.status
      ? String(po.shipments[0].status)
      : null,
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
    confirmedAt: po.confirmedAt?.toISOString() ?? null,
  };
}

export function toSellerOrderDetailDto(po: SellerPurchaseOrderSource) {
  const list = toSellerOrderListDto(po);
  const line = resolveLine(po);
  const dispatch = po.dispatches?.[0];
  const shipment = po.shipments?.[0];
  const delivery = po.deliveries?.[0];
  const pi = po.proformaInvoices?.[0];

  return {
    ...list,
    amounts: {
      subtotal: money(po.subtotal),
      taxAmount: money(po.taxAmount),
      totalAmount: money(po.totalAmount),
    },
    orderedQuantity:
      po.orderedQuantity != null ? qty(po.orderedQuantity) : line.quantity,
    dispatchedQuantity: qty(po.dispatchedQuantity),
    deliveredQuantity: qty(po.deliveredQuantity),
    payment: {
      paymentOption: po.paymentMethod,
      paymentOptionLabel: paymentOptionLabel(po.paymentMethod),
      paymentStatus: list.paymentStatus ?? 'PENDING',
      schedules: (po.paymentSchedules ?? []).map((s) => ({
        id: s.id,
        sequence: s.sequence,
        status: s.status,
        amount: money(s.amount),
        dueAt: s.dueAt?.toISOString() ?? null,
      })),
    },
    proformaInvoice: pi
      ? {
          id: pi.id,
          piNumber: pi.piNumber,
          status: pi.status,
          totalAmount: money(pi.totalAmount),
          createdAt: pi.createdAt.toISOString(),
        }
      : null,
    dispatch: dispatch
      ? {
          id: dispatch.id,
          dispatchNumber: dispatch.dispatchNumber,
          status: dispatch.status,
          plannedDispatchDate:
            dispatch.plannedDispatchDate?.toISOString() ?? null,
          actualDispatchDate:
            dispatch.actualDispatchDate?.toISOString() ?? null,
          destinationRegion: dispatch.destinationRegion ?? null,
        }
      : null,
    shipment: shipment
      ? {
          id: shipment.id,
          referenceNumber: shipment.referenceNumber ?? null,
          status: shipment.status,
          eta: shipment.eta?.toISOString() ?? null,
        }
      : null,
    delivery: delivery
      ? {
          id: delivery.id,
          status: delivery.status,
          deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
        }
      : null,
    purchaseRequest: po.purchaseRequest
      ? {
          id: po.purchaseRequest.id,
          referenceNumber: po.purchaseRequest.referenceNumber,
          status: po.purchaseRequest.status,
        }
      : null,
  };
}

export function buildSellerOrderTimeline(po: SellerPurchaseOrderSource) {
  const events: Array<{
    at: string;
    type: string;
    label: string;
    meta?: Record<string, unknown>;
  }> = [];

  for (const ev of po.purchaseRequest?.events ?? []) {
    // Strip metadata that may contain customer identity.
    events.push({
      at: ev.createdAt.toISOString(),
      type: ev.eventType,
      label: ev.eventType.replaceAll('_', ' '),
    });
  }

  events.push({
    at: po.createdAt.toISOString(),
    type: 'PURCHASE_ORDER_CREATED',
    label: `Purchase order ${po.referenceNumber} created`,
    meta: { status: po.status },
  });

  if (po.confirmedAt) {
    events.push({
      at: po.confirmedAt.toISOString(),
      type: 'ORDER_CONFIRMED',
      label: 'Purchase order confirmed',
    });
  }

  for (const pi of po.proformaInvoices ?? []) {
    events.push({
      at: pi.createdAt.toISOString(),
      type: 'PROFORMA_INVOICE_GENERATED',
      label: `Proforma invoice ${pi.piNumber} generated`,
      meta: { status: pi.status },
    });
  }

  for (const payment of po.payments ?? []) {
    events.push({
      at: (payment.verifiedAt ?? payment.createdAt).toISOString(),
      type: 'PAYMENT',
      label: `Payment ${payment.referenceNumber}`,
      meta: { status: payment.status, amount: money(payment.amount) },
    });
  }

  for (const dispatch of po.dispatches ?? []) {
    events.push({
      at: (dispatch.actualDispatchDate ?? dispatch.createdAt).toISOString(),
      type: 'DISPATCH',
      label: `Dispatch ${dispatch.dispatchNumber}`,
      meta: { status: dispatch.status },
    });
  }

  for (const shipment of po.shipments ?? []) {
    events.push({
      at: shipment.createdAt.toISOString(),
      type: 'SHIPMENT',
      label: shipment.referenceNumber
        ? `Shipment ${shipment.referenceNumber}`
        : 'Shipment updated',
      meta: { status: shipment.status },
    });
  }

  for (const delivery of po.deliveries ?? []) {
    events.push({
      at: (delivery.deliveredAt ?? delivery.createdAt).toISOString(),
      type: 'DELIVERY',
      label: 'Delivery update',
      meta: { status: delivery.status },
    });
  }

  events.sort((a, b) => a.at.localeCompare(b.at));
  return {
    purchaseOrderId: po.id,
    poNumber: po.referenceNumber,
    events,
  };
}

/** Assert serialized seller DTO has no customer identity leakage. */
export function assertBlindSellerOrderPayload(payload: unknown): string[] {
  const serialized = JSON.stringify(payload);
  const leaks: string[] = [];
  for (const key of [
    'customerOrgId',
    'customerId',
    'customerName',
    'customerEmail',
    'customerPhone',
    'customerGSTIN',
    'gstin',
    'email',
    'phone',
  ]) {
    if (serialized.includes(`"${key}"`)) {
      leaks.push(key);
    }
  }
  return leaks;
}
