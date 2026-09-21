import {
  DispatchStatus,
  DeliveryStatus,
  PaymentMethod,
  PaymentStatus,
  PurchaseOrderStatus,
  ShipmentStatus,
} from '../../../generated/prisma/client.js';

export type OrderProgressStage =
  | 'PLACED'
  | 'PROCUREMENT'
  | 'LOADING'
  | 'PAYMENT'
  | 'DISPATCH'
  | 'DELIVERY';

export type OrderPresentationBucket = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export type OrderProgressInput = {
  poStatus: PurchaseOrderStatus;
  paymentMethod?: PaymentMethod | null;
  paymentStatus?: PaymentStatus | string | null;
  creditStatus?: string | null;
  procurementStatus?: string | null;
  dispatchStatus?: DispatchStatus | string | null;
  shipmentStatus?: ShipmentStatus | string | null;
  deliveryStatus?: DeliveryStatus | string | null;
};

const STAGE_PERCENT: Record<OrderProgressStage, number> = {
  PLACED: 10,
  PROCUREMENT: 25,
  LOADING: 45,
  PAYMENT: 60,
  DISPATCH: 75,
  DELIVERY: 100,
};

const TERMINAL_CANCELLED = new Set<string>([
  PurchaseOrderStatus.CANCELLED,
  PurchaseOrderStatus.REJECTED,
]);

const COMPLETED_PO = new Set<string>([
  PurchaseOrderStatus.DELIVERED,
  PurchaseOrderStatus.COMPLETED,
]);

const COMPLETED_DELIVERY = new Set<string>([
  DeliveryStatus.DELIVERED,
  DeliveryStatus.CONFIRMED,
]);

const COMPLETED_SHIPMENT = new Set<string>([
  ShipmentStatus.DELIVERED,
  ShipmentStatus.DELIVERY_CONFIRMED,
]);

function isPaymentCleared(
  paymentStatus?: string | null,
  creditStatus?: string | null,
  paymentMethod?: PaymentMethod | null,
): boolean {
  const pay = (paymentStatus ?? '').toUpperCase();
  if (
    pay === PaymentStatus.VERIFIED ||
    pay === PaymentStatus.PAID ||
    pay === PaymentStatus.PARTIALLY_PAID ||
    pay === PaymentStatus.AUTHORIZED
  ) {
    return true;
  }

  const method = paymentMethod ?? null;
  if (
    method === PaymentMethod.CREDIT ||
    method === PaymentMethod.CREDIT_15 ||
    method === PaymentMethod.CREDIT_30
  ) {
    const credit = (creditStatus ?? '').toUpperCase();
    return (
      credit === 'APPROVED' ||
      credit === 'CREDIT_APPROVED' ||
      credit === 'UTILIZED' ||
      credit === 'CREDIT_UTILIZED' ||
      credit === 'RESERVED' ||
      credit === 'CREDIT_RESERVED'
    );
  }

  return false;
}

function hasDispatchStarted(
  dispatchStatus?: string | null,
  shipmentStatus?: string | null,
  poStatus?: PurchaseOrderStatus,
): boolean {
  const d = (dispatchStatus ?? '').toUpperCase();
  const s = (shipmentStatus ?? '').toUpperCase();
  if (
    d === DispatchStatus.DISPATCHED ||
    d === DispatchStatus.LOADING ||
    d === DispatchStatus.LOADED ||
    d === DispatchStatus.READY_FOR_DISPATCH
  ) {
    return true;
  }
  if (
    s === ShipmentStatus.DISPATCHED ||
    s === ShipmentStatus.IN_TRANSIT ||
    s === ShipmentStatus.OUT_FOR_DELIVERY ||
    s === ShipmentStatus.READY_TO_DISPATCH ||
    s === ShipmentStatus.LOADING
  ) {
    return true;
  }
  return (
    poStatus === PurchaseOrderStatus.READY_FOR_DISPATCH ||
    poStatus === PurchaseOrderStatus.DISPATCHED ||
    poStatus === PurchaseOrderStatus.IN_TRANSIT
  );
}

function hasLoadingStarted(
  dispatchStatus?: string | null,
  shipmentStatus?: string | null,
): boolean {
  const d = (dispatchStatus ?? '').toUpperCase();
  const s = (shipmentStatus ?? '').toUpperCase();
  return (
    d === DispatchStatus.LOADING ||
    d === DispatchStatus.LOADED ||
    d === DispatchStatus.VEHICLE_ASSIGNED ||
    d === DispatchStatus.AWAITING_EWAY_BILL ||
    s === ShipmentStatus.LOADING ||
    s === ShipmentStatus.SLOT_BOOKED
  );
}

function isDelivered(input: OrderProgressInput): boolean {
  const delivery = (input.deliveryStatus ?? '').toUpperCase();
  const shipment = (input.shipmentStatus ?? '').toUpperCase();
  return (
    COMPLETED_PO.has(input.poStatus) ||
    COMPLETED_DELIVERY.has(delivery) ||
    COMPLETED_SHIPMENT.has(shipment)
  );
}

/**
 * Derives customer-facing order progress from authoritative PO + related states.
 * Frontend must render these values as-is.
 */
export function getOrderProgress(input: OrderProgressInput): {
  percentage: number;
  stage: OrderProgressStage;
  status: string;
  presentationBucket: OrderPresentationBucket;
  customerStatus: string;
} {
  if (TERMINAL_CANCELLED.has(input.poStatus)) {
    return {
      percentage: 0,
      stage: 'PLACED',
      status: input.poStatus,
      presentationBucket: 'CANCELLED',
      customerStatus: 'CANCELLED',
    };
  }

  if (isDelivered(input)) {
    return {
      percentage: STAGE_PERCENT.DELIVERY,
      stage: 'DELIVERY',
      status: input.poStatus,
      presentationBucket: 'COMPLETED',
      customerStatus: 'DELIVERED',
    };
  }

  const paymentCleared = isPaymentCleared(
    input.paymentStatus,
    input.creditStatus,
    input.paymentMethod,
  );
  const dispatchStarted = hasDispatchStarted(
    input.dispatchStatus,
    input.shipmentStatus,
    input.poStatus,
  );
  const loadingStarted = hasLoadingStarted(
    input.dispatchStatus,
    input.shipmentStatus,
  );

  let stage: OrderProgressStage = 'PLACED';

  if (dispatchStarted && paymentCleared) {
    stage = 'DISPATCH';
  } else if (paymentCleared) {
    stage = 'PAYMENT';
  } else if (loadingStarted) {
    stage = 'LOADING';
  } else if (
    input.poStatus === PurchaseOrderStatus.CONFIRMED ||
    input.poStatus === PurchaseOrderStatus.SENT_TO_SELLER ||
    input.poStatus === PurchaseOrderStatus.SELLER_REVIEW ||
    Boolean(input.procurementStatus)
  ) {
    stage = 'PROCUREMENT';
  }

  // ON_LOADING / ON_DELIVERY may reach dispatch readiness before cash clears.
  if (
    dispatchStarted &&
    !paymentCleared &&
    (input.paymentMethod === PaymentMethod.ON_LOADING ||
      input.paymentMethod === PaymentMethod.ON_DELIVERY)
  ) {
    stage = 'DISPATCH';
  }

  const customerStatusMap: Record<OrderProgressStage, string> = {
    PLACED: 'ORDER_CREATED',
    PROCUREMENT: 'PROCUREMENT',
    LOADING: 'LOADING',
    PAYMENT: 'PAYMENT',
    DISPATCH: 'READY_FOR_DISPATCH',
    DELIVERY: 'DELIVERY',
  };

  return {
    percentage: STAGE_PERCENT[stage],
    stage,
    status: input.poStatus,
    presentationBucket: 'ACTIVE',
    customerStatus: customerStatusMap[stage],
  };
}

export function presentationBucketForPoStatus(
  poStatus: PurchaseOrderStatus,
  deliveryStatus?: string | null,
  shipmentStatus?: string | null,
): OrderPresentationBucket {
  return getOrderProgress({
    poStatus,
    deliveryStatus,
    shipmentStatus,
  }).presentationBucket;
}

export function paymentOptionLabel(method?: PaymentMethod | null): string {
  switch (method) {
    case PaymentMethod.ADVANCE:
      return 'ADVANCE PAYMENT';
    case PaymentMethod.BEFORE_DISPATCH:
      return 'BEFORE DISPATCH PAYMENT';
    case PaymentMethod.ON_LOADING:
      return 'ON LOADING PAYMENT';
    case PaymentMethod.ON_DELIVERY:
      return 'ON DELIVERY PAYMENT';
    case PaymentMethod.CREDIT:
      return 'PETROTRADE CREDIT';
    case PaymentMethod.CREDIT_15:
      return 'PETROTRADE CREDIT (15 DAYS)';
    case PaymentMethod.CREDIT_30:
      return 'PETROTRADE CREDIT (30 DAYS)';
    case PaymentMethod.PARTIAL_ADVANCE:
      return 'PARTIAL ADVANCE';
    case PaymentMethod.PARTIAL_PAYMENT:
      return 'PARTIAL PAYMENT';
    case PaymentMethod.MILESTONE_PAYMENT:
      return 'MILESTONE PAYMENT';
    default:
      return method ? method.replaceAll('_', ' ') : 'PAYMENT';
  }
}
