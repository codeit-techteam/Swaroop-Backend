import {
  ImportDealStatus,
  ImportShipmentStatus as S,
  Prisma,
} from '../../../generated/prisma/client.js';
import { ImportException } from './import.errors.js';

const RECOVERABLE: readonly S[] = [
  S.SHIPPED,
  S.IN_TRANSIT,
  S.ARRIVED,
  S.CUSTOMS_CLEARANCE,
  S.OUT_FOR_DELIVERY,
  S.DELIVERED,
];

const TRANSITIONS: Record<S, readonly S[]> = {
  [S.BOOKED]: [S.SHIPPED, S.EXCEPTION, S.CANCELLED],
  [S.SHIPPED]: [S.IN_TRANSIT, S.ARRIVED, S.EXCEPTION],
  [S.IN_TRANSIT]: [S.ARRIVED, S.EXCEPTION],
  [S.ARRIVED]: [
    S.CUSTOMS_CLEARANCE,
    S.OUT_FOR_DELIVERY,
    S.DELIVERED,
    S.EXCEPTION,
  ],
  [S.CUSTOMS_CLEARANCE]: [S.OUT_FOR_DELIVERY, S.DELIVERED, S.EXCEPTION],
  [S.OUT_FOR_DELIVERY]: [S.DELIVERED, S.EXCEPTION],
  [S.EXCEPTION]: [...RECOVERABLE, S.CANCELLED],
  [S.DELIVERED]: [],
  [S.CANCELLED]: [],
};

/** Deals that can still receive new shipments. */
export const SHIPPABLE_DEAL_STATUSES: readonly ImportDealStatus[] = [
  ImportDealStatus.CONFIRMED,
  ImportDealStatus.PARTIALLY_FULFILLED,
];

/** Shipments that count against the deal quantity. */
export const ACTIVE_SHIPMENT_STATUSES: readonly S[] = Object.values(S).filter(
  (s) => s !== S.CANCELLED,
);

export function shipmentTransitions(from: S): readonly S[] {
  return TRANSITIONS[from];
}

export function assertShipmentTransition(from: S, to: S): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new ImportException(
      'IMPORT_INVALID_STATUS_TRANSITION',
      `A ${label(from)} shipment cannot move to ${label(to)}.`,
      { from, to, allowed: TRANSITIONS[from] },
    );
  }
}

export function isTerminalShipment(status: S): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Milestone timestamps written when a shipment reaches a status. */
export function milestoneFields(
  to: S,
  at: Date,
): Prisma.ImportShipmentUpdateManyMutationInput {
  switch (to) {
    case S.SHIPPED:
      return { departedAt: at, exceptionReason: null };
    case S.ARRIVED:
      return { arrivedAt: at, exceptionReason: null };
    case S.DELIVERED:
      return { deliveredAt: at, exceptionReason: null };
    case S.CANCELLED:
      return { cancelledAt: at };
    case S.EXCEPTION:
      return {};
    default:
      return { exceptionReason: null };
  }
}

/**
 * Deal fulfilment derived from delivered quantity. Returns null when the deal
 * should keep its current status.
 */
export function fulfilmentStatus(
  current: ImportDealStatus,
  dealQuantity: Prisma.Decimal,
  deliveredQuantity: Prisma.Decimal,
): ImportDealStatus | null {
  if (!SHIPPABLE_DEAL_STATUSES.includes(current)) return null;
  if (deliveredQuantity.lte(0)) return null;
  const target = deliveredQuantity.gte(dealQuantity)
    ? ImportDealStatus.FULFILLED
    : ImportDealStatus.PARTIALLY_FULFILLED;
  return target === current ? null : target;
}

function label(s: S) {
  return s.toLowerCase().replace(/_/g, ' ');
}
