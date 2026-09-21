import { toDecimal } from '../../payments/common/money.util.js';
import {
  getOrderProgress,
  paymentOptionLabel,
  type OrderProgressStage,
} from './customer-orders.progress.js';
import type {
  DeliveryStatus,
  DispatchStatus,
  PaymentMethod,
  PaymentStatus,
  PurchaseOrderStatus,
  ShipmentStatus,
} from '../../../generated/prisma/client.js';

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
  offerId?: string | null;
  quantity?: unknown;
  unit?: string | null;
  unitPriceSnapshot?: unknown;
  targetUnitPrice?: unknown;
  grade?: {
    id: string;
    code: string;
    name: string;
    displayName: string | null;
    category?: { code: string; name: string } | null;
  } | null;
  product?: {
    id: string;
    code: string;
    name: string;
  } | null;
};

export type PurchaseOrderProjectionSource = {
  id: string;
  referenceNumber: string;
  purchaseRequestId: string | null;
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
    items?: PoItemSource[];
    events?: Array<{
      id: string;
      eventType: string;
      createdAt: Date;
      metadata?: unknown;
    }>;
  } | null;
  procurementCase?: {
    id: string;
    referenceNumber: string;
    status: string;
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
  dispatches?: Array<{
    id: string;
    dispatchNumber: string;
    status: DispatchStatus | string;
    actualDispatchDate: Date | null;
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
  creditTransactions?: Array<{
    id: string;
    type: string;
    status: string;
    amount: unknown;
    createdAt: Date;
  }>;
};

function money(value: unknown): string {
  return toDecimal(value as never).toFixed(2);
}

function qty(value: unknown): number {
  return Number(toDecimal(value as never).toFixed(3));
}

function resolveItems(po: PurchaseOrderProjectionSource) {
  const snapshot = (po.metadata as { commercialSnapshot?: CommercialSnapshot } | null)
    ?.commercialSnapshot;
  const prItems = po.purchaseRequest?.items ?? [];

  if (prItems.length > 0) {
    return prItems.map((item) => {
      const quantity = qty(item.quantity ?? snapshot?.quantity ?? po.orderedQuantity ?? 0);
      const unitPrice = Number(
        toDecimal(
          (item.unitPriceSnapshot as never) ??
            (item.targetUnitPrice as never) ??
            snapshot?.unitPrice ??
            0,
        ).toFixed(4),
      );
      const totalAmount = Number(
        toDecimal(unitPrice).times(quantity).toFixed(2),
      );
      return {
        productId: item.productId ?? snapshot?.productId ?? null,
        gradeId: item.gradeId ?? snapshot?.gradeId ?? null,
        productName: item.product?.name ?? 'Material',
        productCode: item.product?.code ?? null,
        gradeName:
          item.grade?.displayName ?? item.grade?.name ?? item.grade?.code ?? '—',
        gradeCode: item.grade?.code ?? null,
        categoryCode: item.grade?.category?.code ?? null,
        categoryName: item.grade?.category?.name ?? null,
        quantity,
        unit: item.unit ?? snapshot?.unit ?? 'MT',
        unitPrice,
        totalAmount,
      };
    });
  }

  const quantity = qty(snapshot?.quantity ?? po.orderedQuantity ?? 0);
  const unitPrice = Number(toDecimal(snapshot?.unitPrice ?? 0).toFixed(4));
  return [
    {
      productId: snapshot?.productId ?? null,
      gradeId: snapshot?.gradeId ?? null,
      productName: 'Material',
      productCode: null,
      gradeName: '—',
      gradeCode: null,
      categoryCode: null,
      categoryName: null,
      quantity,
      unit: snapshot?.unit ?? 'MT',
      unitPrice,
      totalAmount: Number(money(po.totalAmount)),
    },
  ];
}

function latestPaymentStatus(po: PurchaseOrderProjectionSource): string | null {
  const payment = po.payments?.[0];
  return payment?.status ? String(payment.status) : null;
}

function creditStatus(po: PurchaseOrderProjectionSource): string | null {
  const txn = po.creditTransactions?.[0];
  if (!txn) return null;
  return txn.type;
}

function paymentVerified(po: PurchaseOrderProjectionSource): boolean {
  return (po.payments ?? []).some((p) => {
    const s = String(p.status).toUpperCase();
    return s === 'VERIFIED' || s === 'PAID' || s === 'AUTHORIZED';
  });
}

export function toCustomerOrderDto(
  po: PurchaseOrderProjectionSource,
  options?: { detailed?: boolean },
) {
  const items = resolveItems(po);
  const primary = items[0];
  const paymentStatus = latestPaymentStatus(po);
  const credit = creditStatus(po);
  const dispatch = po.dispatches?.[0];
  const shipment = po.shipments?.[0];
  const delivery = po.deliveries?.[0];
  const progress = getOrderProgress({
    poStatus: po.status,
    paymentMethod: po.paymentMethod,
    paymentStatus,
    creditStatus: credit,
    procurementStatus: po.procurementCase?.status ?? null,
    dispatchStatus: dispatch?.status ?? null,
    shipmentStatus: shipment?.status ?? null,
    deliveryStatus: delivery?.status ?? null,
  });

  const amountPaid = (po.payments ?? [])
    .filter((p) => {
      const s = String(p.status).toUpperCase();
      return s === 'VERIFIED' || s === 'PAID' || s === 'PARTIALLY_PAID';
    })
    .reduce((sum, p) => sum + Number(money(p.amount)), 0);

  const total = Number(money(po.totalAmount));
  const amountDue = Math.max(0, Number((total - amountPaid).toFixed(2)));
  const verified = paymentVerified(po);

  const base = {
    id: po.id,
    orderNumber: po.referenceNumber,
    purchaseOrderId: po.id,
    purchaseRequestId: po.purchaseRequestId,
    purchaseRequestNumber: po.purchaseRequest?.referenceNumber ?? null,
    status: progress.customerStatus,
    backendStatus: po.status,
    presentationBucket: progress.presentationBucket,
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
    confirmedAt: po.confirmedAt?.toISOString() ?? null,
    currency: po.currency,
    items,
    productName: primary?.productName ?? 'Material',
    gradeName: primary?.gradeName ?? '—',
    categoryCode: primary?.categoryCode ?? null,
    categoryName: primary?.categoryName ?? null,
    quantity: primary?.quantity ?? 0,
    unit: primary?.unit ?? 'MT',
    payment: {
      paymentOption: po.paymentMethod,
      paymentOptionLabel: paymentOptionLabel(po.paymentMethod),
      paymentStatus: paymentStatus ?? 'PENDING',
      amountPaid: amountPaid.toFixed(2),
      amountDue: amountDue.toFixed(2),
      verifiedByPetroTrade: verified,
      creditStatus: credit,
    },
    progress: {
      percentage: progress.percentage,
      stage: progress.stage as OrderProgressStage,
      status: progress.status,
      label: progressLabel(progress.stage),
    },
    procurement: {
      status: po.procurementCase?.status ?? null,
      referenceNumber: po.procurementCase?.referenceNumber ?? null,
    },
    dispatch: {
      status: dispatch?.status ?? null,
      dispatchNumber: dispatch?.dispatchNumber ?? null,
    },
    shipment: {
      status: shipment?.status ?? null,
      referenceNumber: shipment?.referenceNumber ?? null,
      estimatedDeliveryDate: shipment?.eta?.toISOString() ?? null,
    },
    delivery: {
      status: delivery?.status ?? null,
      deliveredAt: delivery?.deliveredAt?.toISOString() ?? null,
    },
    amounts: {
      subtotal: money(po.subtotal),
      taxAmount: money(po.taxAmount),
      totalAmount: money(po.totalAmount),
    },
  };

  if (!options?.detailed) {
    return base;
  }

  return {
    ...base,
    proformaInvoices: (po.proformaInvoices ?? []).map((pi) => ({
      id: pi.id,
      piNumber: pi.piNumber,
      status: pi.status,
      totalAmount: money(pi.totalAmount),
      createdAt: pi.createdAt.toISOString(),
    })),
    payments: (po.payments ?? []).map((p) => ({
      id: p.id,
      referenceNumber: p.referenceNumber,
      status: p.status,
      amount: money(p.amount),
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}

function progressLabel(stage: OrderProgressStage): string {
  switch (stage) {
    case 'PLACED':
      return 'Order Placed';
    case 'PROCUREMENT':
      return 'Procurement in Progress';
    case 'LOADING':
      return 'Loading';
    case 'PAYMENT':
      return 'Payment Processing';
    case 'DISPATCH':
      return 'Ready for Dispatch';
    case 'DELIVERY':
      return 'Delivered';
    default:
      return 'In Progress';
  }
}

export function buildCustomerOrderTimeline(po: PurchaseOrderProjectionSource) {
  const events: Array<{
    at: string;
    type: string;
    label: string;
    meta?: Record<string, unknown>;
  }> = [];

  for (const ev of po.purchaseRequest?.events ?? []) {
    events.push({
      at: ev.createdAt.toISOString(),
      type: ev.eventType,
      label: ev.eventType.replaceAll('_', ' '),
      meta: (ev.metadata as Record<string, unknown> | null) ?? undefined,
    });
  }

  events.push({
    at: po.createdAt.toISOString(),
    type: 'PO_CREATED',
    label: `Purchase order ${po.referenceNumber} created`,
    meta: { status: po.status },
  });

  if (po.confirmedAt) {
    events.push({
      at: po.confirmedAt.toISOString(),
      type: 'PO_CONFIRMED',
      label: 'Purchase order confirmed',
    });
  }

  for (const pi of po.proformaInvoices ?? []) {
    events.push({
      at: pi.createdAt.toISOString(),
      type: 'PROFORMA_INVOICE_CREATED',
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

  for (const credit of po.creditTransactions ?? []) {
    events.push({
      at: credit.createdAt.toISOString(),
      type: credit.type,
      label: credit.type.replaceAll('_', ' '),
      meta: { status: credit.status, amount: money(credit.amount) },
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
  return { purchaseOrderId: po.id, orderNumber: po.referenceNumber, events };
}
