import { BLIND_BUYER_DISPLAY_NAME } from '../common/blind-buyer.js';
import type {
  SellerWorkbenchAlert,
  SellerWorkbenchDispatchStatus,
  SellerWorkbenchPaymentStatus,
  SellerWorkbenchPriority,
  SellerWorkbenchStage,
} from './seller-procurement-workbench.dto.js';

export type WorkbenchPurchaseOrder = {
  id: string;
  referenceNumber: string;
  status: string;
  totalAmount: unknown;
  orderedQuantity: unknown;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  payments?: Array<{
    id: string;
    status: string;
    amount: unknown;
    createdAt: Date;
  }>;
  dispatches?: Array<{
    id: string;
    dispatchNumber: string | null;
    status: string;
    plannedDispatchDate: Date | null;
    createdAt: Date;
    slots?: Array<{ id: string; status: string }>;
  }>;
  shipments?: Array<{
    id: string;
    referenceNumber: string;
    status: string;
    eta: Date | null;
    createdAt: Date;
  }>;
  deliveries?: Array<{
    id: string;
    status: string;
    deliveredAt: Date | null;
  }>;
};

export type WorkbenchSource = {
  id: string;
  referenceNumber: string;
  status: string;
  priority: string;
  paymentMethod: string | null;
  targetPrice: unknown;
  currency: string;
  requiredByDate: Date | null;
  deliveryLocation: string | null;
  destinationRegion: string | null;
  responseDeadline: Date | null;
  expiresAt: Date | null;
  commerciallyAcceptedAt: Date | null;
  customerOrgId: string;
  createdAt: Date;
  updatedAt: Date;
  items?: Array<{
    id: string;
    quantity: unknown;
    unit: string;
    targetUnitPrice: unknown;
    grade?: {
      id: string;
      code: string;
      name: string;
      displayName: string | null;
    } | null;
    product?: { id: string; code: string; name: string } | null;
  }>;
  priceRevisions?: Array<{
    id: string;
    status: string;
    previousPrice: unknown;
    proposedPrice: unknown;
    createdAt: Date;
    updatedAt: Date;
  }>;
  purchaseOrders?: WorkbenchPurchaseOrder[];
  counterOffers?: Array<{
    id: string;
    status: string;
    createdByRole: string;
    unitPrice: unknown;
    createdAt: Date;
  }>;
};

function num(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function maskLocation(value: string | null | undefined): string {
  if (!value?.trim()) return 'Assigned destination';
  const trimmed = value.trim();
  if (trimmed.length > 40) return `${trimmed.slice(0, 24)}…`;
  return trimmed;
}

function mapPriority(priority: string): SellerWorkbenchPriority {
  const raw = (priority ?? '').toUpperCase();
  if (raw === 'URGENT' || raw === 'CRITICAL') return 'CRITICAL';
  if (raw === 'HIGH') return 'HIGH';
  if (raw === 'LOW') return 'LOW';
  return 'MEDIUM';
}

function mapPaymentStatus(
  po?: WorkbenchPurchaseOrder,
): SellerWorkbenchPaymentStatus {
  const pay = (po?.payments?.[0]?.status ?? '').toUpperCase();
  if (pay === 'OVERDUE') return 'OVERDUE';
  if (pay === 'PARTIALLY_PAID') return 'PARTIALLY_PAID';
  if (pay === 'PAID' || pay === 'VERIFIED' || pay === 'AUTHORIZED') {
    return 'PAID';
  }
  return 'PAYMENT_PENDING';
}

function mapDispatchStatus(
  po?: WorkbenchPurchaseOrder,
): SellerWorkbenchDispatchStatus {
  const shipment = (po?.shipments?.[0]?.status ?? '').toUpperCase();
  const delivery = (po?.deliveries?.[0]?.status ?? '').toUpperCase();
  const dispatch = (po?.dispatches?.[0]?.status ?? '').toUpperCase();
  const poStatus = (po?.status ?? '').toUpperCase();

  if (
    delivery === 'DELIVERED' ||
    delivery === 'CONFIRMED' ||
    shipment === 'DELIVERED' ||
    shipment === 'DELIVERY_CONFIRMED' ||
    poStatus === 'DELIVERED' ||
    poStatus === 'COMPLETED'
  ) {
    return 'DELIVERED';
  }
  if (
    shipment === 'IN_TRANSIT' ||
    shipment === 'OUT_FOR_DELIVERY' ||
    poStatus === 'IN_TRANSIT'
  ) {
    return 'IN_TRANSIT';
  }
  if (
    dispatch === 'DISPATCHED' ||
    shipment === 'DISPATCHED' ||
    poStatus === 'DISPATCHED'
  ) {
    return 'DISPATCHED';
  }
  if (
    dispatch === 'READY_FOR_DISPATCH' ||
    dispatch === 'VEHICLE_ASSIGNED' ||
    dispatch === 'LOADING' ||
    dispatch === 'LOADED' ||
    poStatus === 'READY_FOR_DISPATCH'
  ) {
    return 'READY_FOR_DISPATCH';
  }
  return 'NOT_STARTED';
}

function deriveStage(
  pr: WorkbenchSource,
  paymentStatus: SellerWorkbenchPaymentStatus,
  dispatchStatus: SellerWorkbenchDispatchStatus,
): SellerWorkbenchStage {
  const po = pr.purchaseOrders?.[0];
  const prStatus = (pr.status ?? '').toUpperCase();
  const revision = pr.priceRevisions?.find((r) => {
    const s = (r.status ?? '').toUpperCase();
    return (
      s === 'PENDING' || s === 'AWAITING_RESPONSE' || s === 'COUNTER_OFFER'
    );
  });

  if (dispatchStatus === 'DELIVERED') return 'SETTLEMENT';
  if (dispatchStatus === 'IN_TRANSIT' || dispatchStatus === 'DISPATCHED') {
    return 'SHIPMENT';
  }
  if (
    dispatchStatus === 'READY_FOR_DISPATCH' ||
    (po && paymentStatus === 'PAID')
  ) {
    if (po && paymentStatus === 'PAID') return 'DISPATCH';
  }
  if (po) {
    if (
      paymentStatus === 'PAYMENT_PENDING' ||
      paymentStatus === 'PARTIALLY_PAID' ||
      paymentStatus === 'OVERDUE'
    ) {
      const poStatus = (po.status ?? '').toUpperCase();
      if (
        poStatus === 'CONFIRMED' ||
        poStatus === 'SELLER_REVIEW' ||
        poStatus === 'SENT_TO_SELLER'
      ) {
        return paymentStatus === 'PAYMENT_PENDING' && !po.confirmedAt
          ? 'PO'
          : 'PAYMENT';
      }
      return 'PAYMENT';
    }
    return 'PO';
  }
  if (revision) return 'PRICE_REVISION';
  if (
    prStatus === 'NEGOTIATION' ||
    pr.counterOffers?.some((c) => c.status === 'PENDING')
  ) {
    return 'COMMERCIAL_REVIEW';
  }
  if (pr.commerciallyAcceptedAt) return 'COMMERCIAL_REVIEW';
  return 'PR';
}

function buildAlerts(input: {
  stage: SellerWorkbenchStage;
  priority: SellerWorkbenchPriority;
  paymentStatus: SellerWorkbenchPaymentStatus;
  dispatchStatus: SellerWorkbenchDispatchStatus;
  poAcknowledged: boolean;
  hasVehicleSlot: boolean;
  documentsMissing: boolean;
  delayed: boolean;
  revisionDueToday: boolean;
}): SellerWorkbenchAlert[] {
  const alerts: SellerWorkbenchAlert[] = [];
  if (input.revisionDueToday) alerts.push('PRICE_REVISION_DUE_TODAY');
  if (
    (input.paymentStatus === 'PAYMENT_PENDING' ||
      input.paymentStatus === 'OVERDUE') &&
    (input.stage === 'PAYMENT' ||
      input.stage === 'PO' ||
      input.paymentStatus === 'OVERDUE')
  ) {
    alerts.push('PAYMENT_PENDING');
  }
  if (
    (input.stage === 'DISPATCH' ||
      input.dispatchStatus === 'READY_FOR_DISPATCH') &&
    input.paymentStatus === 'PAID' &&
    !input.hasVehicleSlot
  ) {
    alerts.push('VEHICLE_SLOT_MISSING');
  }
  if (input.stage === 'PO' && !input.poAcknowledged) {
    alerts.push('PO_AWAITING_CONFIRMATION');
  }
  if (input.documentsMissing) alerts.push('DOCUMENTS_MISSING');
  if (input.delayed) alerts.push('DISPATCH_DELAYED');
  return alerts;
}

function isRevisionDueToday(
  revisions: WorkbenchSource['priceRevisions'],
): boolean {
  if (!revisions?.length) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return revisions.some((r) => {
    const s = (r.status ?? '').toUpperCase();
    if (s !== 'PENDING' && s !== 'AWAITING_RESPONSE' && s !== 'COUNTER_OFFER') {
      return false;
    }
    const updated = r.updatedAt ?? r.createdAt;
    return updated >= today && updated < tomorrow;
  });
}

/**
 * Map an internal PurchaseRequest (+ related PO/logistics) to a Seller-safe
 * Procurement Workbench item. Never serializes customer identity.
 */
export function toSellerBlindProcurementItem(record: WorkbenchSource) {
  const item = record.items?.[0];
  const po = record.purchaseOrders?.[0];
  const revision = record.priceRevisions?.[0];
  const paymentStatus = mapPaymentStatus(po);
  const dispatchStatus = mapDispatchStatus(po);
  const currentStage = deriveStage(record, paymentStatus, dispatchStatus);
  const priority = mapPriority(record.priority);
  const quantity = num(item?.quantity ?? po?.orderedQuantity);
  const unitPrice = num(
    item?.targetUnitPrice ?? record.targetPrice ?? revision?.proposedPrice,
  );
  const orderValue =
    num(po?.totalAmount) ||
    (quantity > 0 && unitPrice > 0 ? quantity * unitPrice * 1000 : 0);
  const hasVehicleSlot = Boolean(po?.dispatches?.[0]?.slots?.length);
  const poAcknowledged = Boolean(
    po?.confirmedAt ||
    [
      'CONFIRMED',
      'READY_FOR_DISPATCH',
      'DISPATCHED',
      'IN_TRANSIT',
      'DELIVERED',
      'COMPLETED',
    ].includes((po?.status ?? '').toUpperCase()),
  );
  const delayed =
    dispatchStatus !== 'DELIVERED' &&
    Boolean(
      po?.dispatches?.[0]?.plannedDispatchDate &&
      po.dispatches[0].plannedDispatchDate.getTime() < Date.now() &&
      dispatchStatus === 'NOT_STARTED',
    );
  const documentsMissing = Boolean(po) && !poAcknowledged;
  const alerts = buildAlerts({
    stage: currentStage,
    priority,
    paymentStatus,
    dispatchStatus,
    poAcknowledged,
    hasVehicleSlot,
    documentsMissing,
    delayed,
    revisionDueToday: isRevisionDueToday(record.priceRevisions),
  });

  const originalPrice = num(
    revision?.previousPrice ?? item?.targetUnitPrice ?? record.targetPrice,
  );
  const requestedPrice = num(
    revision?.proposedPrice ?? item?.targetUnitPrice ?? record.targetPrice,
  );
  const pendingCounter = record.counterOffers?.find(
    (c) => (c.status ?? '').toUpperCase() === 'PENDING',
  );

  return {
    id: record.id,
    referenceId: record.referenceNumber,
    purchaseRequestId: record.referenceNumber,
    orderId: po?.referenceNumber ?? null,
    priceRevisionId: revision?.id ?? null,
    buyerDisplayName: BLIND_BUYER_DISPLAY_NAME,
    productId: item?.product?.id ?? null,
    productName: item?.product?.name ?? item?.grade?.name ?? 'Product',
    gradeId: item?.grade?.id ?? null,
    gradeName:
      item?.grade?.displayName ??
      item?.grade?.name ??
      item?.grade?.code ??
      'Grade',
    quantity,
    quantityUnit: item?.unit ?? 'MT',
    currentStage,
    orderValue,
    currency: record.currency || 'INR',
    paymentStatus,
    dispatchStatus,
    settlementStatus:
      dispatchStatus === 'DELIVERED' ? 'SETTLEMENT_PENDING' : null,
    priority,
    deliveryLocation:
      record.destinationRegion ?? maskLocation(record.deliveryLocation),
    expectedDelivery: record.requiredByDate?.toISOString() ?? null,
    warehouseName: null as string | null,
    paymentTerms: record.paymentMethod ?? 'OTHER',
    lastUpdatedAt: record.updatedAt.toISOString(),
    overdue: paymentStatus === 'OVERDUE' || delayed,
    delayed,
    poAcknowledged,
    documentsMissing,
    commercial: {
      originalPrice,
      requestedPrice,
      counterPrice: pendingCounter ? num(pendingCounter.unitPrice) : null,
      finalPrice: po ? unitPrice || null : null,
      paymentTerms: record.paymentMethod ?? 'OTHER',
      deliveryTerms:
        record.destinationRegion ?? maskLocation(record.deliveryLocation),
    },
    order: {
      poNumber: po?.referenceNumber ?? null,
      orderNumber: po?.referenceNumber ?? null,
      orderStatus: po?.status ?? null,
      quantityMt: quantity,
      warehouseName: null as string | null,
      dispatchStatus,
    },
    payment: {
      method: record.paymentMethod ?? 'OTHER',
      status: paymentStatus,
      amountPaid:
        paymentStatus === 'PAID'
          ? orderValue
          : paymentStatus === 'PARTIALLY_PAID'
            ? orderValue / 2
            : 0,
      amountPending:
        paymentStatus === 'PAID'
          ? 0
          : paymentStatus === 'PARTIALLY_PAID'
            ? orderValue / 2
            : orderValue,
      dueDate: record.requiredByDate?.toISOString() ?? null,
      orderValue,
    },
    fulfillment: {
      vehicleSlotId: po?.dispatches?.[0]?.slots?.[0]?.id ?? null,
      dispatchDate:
        po?.dispatches?.[0]?.plannedDispatchDate?.toISOString() ?? null,
      vehicleNumber: null as string | null,
      shipmentId: po?.shipments?.[0]?.referenceNumber ?? null,
      trackingStatus: dispatchStatus,
    },
    documents: [] as Array<{
      id: string;
      name: string;
      kind: string;
      uploadedAt?: string;
      available: boolean;
    }>,
    timeline: [
      {
        id: 'pr',
        label: 'PR Received',
        status: 'completed' as const,
        at: record.createdAt.toISOString(),
        actor: 'System',
      },
      {
        id: 'commercial',
        label: 'Commercial Review',
        status:
          currentStage === 'PR'
            ? ('pending' as const)
            : currentStage === 'COMMERCIAL_REVIEW'
              ? ('current' as const)
              : ('completed' as const),
      },
      {
        id: 'price',
        label: 'Price Revision',
        status:
          currentStage === 'PRICE_REVISION'
            ? ('current' as const)
            : ['PO', 'PAYMENT', 'DISPATCH', 'SHIPMENT', 'SETTLEMENT'].includes(
                  currentStage,
                )
              ? ('completed' as const)
              : ('pending' as const),
      },
      {
        id: 'po',
        label: 'PO',
        status:
          currentStage === 'PO'
            ? ('current' as const)
            : ['PAYMENT', 'DISPATCH', 'SHIPMENT', 'SETTLEMENT'].includes(
                  currentStage,
                )
              ? ('completed' as const)
              : ('pending' as const),
      },
      {
        id: 'payment',
        label: 'Payment',
        status:
          currentStage === 'PAYMENT'
            ? ('current' as const)
            : ['DISPATCH', 'SHIPMENT', 'SETTLEMENT'].includes(currentStage)
              ? ('completed' as const)
              : ('pending' as const),
      },
      {
        id: 'dispatch',
        label: 'Dispatch',
        status:
          currentStage === 'DISPATCH'
            ? ('current' as const)
            : ['SHIPMENT', 'SETTLEMENT'].includes(currentStage)
              ? ('completed' as const)
              : ('pending' as const),
      },
      {
        id: 'shipment',
        label: 'Shipment',
        status:
          currentStage === 'SHIPMENT'
            ? ('current' as const)
            : currentStage === 'SETTLEMENT'
              ? ('completed' as const)
              : ('pending' as const),
      },
      {
        id: 'settlement',
        label: 'Settlement',
        status:
          currentStage === 'SETTLEMENT'
            ? ('current' as const)
            : ('pending' as const),
      },
    ],
    activity: [
      {
        id: `act-${record.id}`,
        at: record.updatedAt.toISOString(),
        actor: 'System',
        message: `Procurement at stage ${currentStage.replaceAll('_', ' ')}.`,
      },
    ],
    alerts,
  };
}

export type SellerBlindProcurementItem = ReturnType<
  typeof toSellerBlindProcurementItem
>;
