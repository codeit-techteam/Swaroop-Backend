import type { NegotiationActorRole } from '../../../generated/prisma/client.js';
import {
  BLIND_BUYER_DISPLAY_NAME,
  anonymousBuyer,
} from '../common/blind-buyer.js';

export type SellerPriceRevisionStatus =
  | 'PENDING'
  | 'AWAITING_RESPONSE'
  | 'COUNTER_OFFER'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED';

export { anonymousBuyer, BLIND_BUYER_DISPLAY_NAME };

export function mapSellerPriceRevisionStatus(
  status: string,
  opts?: {
    responseDeadline?: Date | null;
    hasSellerCounter?: boolean;
    awaitingBuyer?: boolean;
  },
): SellerPriceRevisionStatus {
  const raw = (status ?? '').trim().toUpperCase();
  if (raw === 'APPLIED' || raw === 'ACCEPTED') return 'ACCEPTED';
  if (raw === 'REJECTED') return 'REJECTED';
  if (raw === 'CANCELLED') return 'CANCELLED';
  if (raw === 'EXPIRED') return 'EXPIRED';
  if (raw === 'COUNTER_OFFER' || raw === 'COUNTER_OFFERED') {
    return 'COUNTER_OFFER';
  }
  if (raw === 'AWAITING_RESPONSE') return 'AWAITING_RESPONSE';

  if (
    opts?.responseDeadline &&
    opts.responseDeadline.getTime() < Date.now() &&
    (raw === 'PENDING' || !raw)
  ) {
    return 'EXPIRED';
  }

  if (opts?.awaitingBuyer || opts?.hasSellerCounter) {
    return 'AWAITING_RESPONSE';
  }

  return 'PENDING';
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export type PriceRevisionSource = {
  id: string;
  offerId: string | null;
  purchaseRequestId: string | null;
  previousPrice: unknown;
  proposedPrice: unknown;
  currency: string;
  reason: string | null;
  status: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  purchaseRequest?: {
    id: string;
    referenceNumber: string;
    customerOrgId: string;
    currency: string;
    paymentMethod: string | null;
    destinationRegion: string | null;
    deliveryLocation: string | null;
    requiredByDate: Date | null;
    responseDeadline: Date | null;
    expiresAt: Date | null;
    status: string;
    sellerRespondedAt: Date | null;
    items?: Array<{
      quantity: unknown;
      unit: string;
      targetUnitPrice: unknown;
      unitPriceSnapshot: unknown;
      grade?: {
        id: string;
        code: string;
        name: string;
        displayName: string | null;
      } | null;
      product?: { id: string; code: string; name: string } | null;
    }>;
    purchaseOrders?: Array<{
      id: string;
      referenceNumber: string;
      status: string;
    }>;
    counterOffers?: Array<{
      id: string;
      createdByRole: NegotiationActorRole;
      unitPrice: unknown;
      quantity: unknown;
      note: string | null;
      status: string;
      createdAt: Date;
    }>;
  } | null;
  offer?: {
    id: string;
    referenceNumber: string;
    organizationId: string;
    basePrice: unknown;
    currency: string;
    product?: { id: string; code: string; name: string } | null;
    grade?: {
      id: string;
      code: string;
      name: string;
      displayName: string | null;
    } | null;
  } | null;
};

/**
 * Seller-safe Price Revision DTO — never serializes customer identity.
 */
export function toBlindSellerPriceRevision(row: PriceRevisionSource) {
  const pr = row.purchaseRequest ?? null;
  const offer = row.offer ?? null;
  const item = pr?.items?.[0];
  const meta =
    row.metadata &&
    typeof row.metadata === 'object' &&
    !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};

  const customerOrgId = pr?.customerOrgId ?? '';
  const buyer = customerOrgId
    ? anonymousBuyer(customerOrgId)
    : { displayName: BLIND_BUYER_DISPLAY_NAME, reference: 'BUYER-UNKNOWN' };

  const originalPrice = toNumber(row.previousPrice);
  const requestedPrice = toNumber(row.proposedPrice);
  const quantity = toNumber(item?.quantity ?? meta.counterQuantity ?? 0);
  const unit = item?.unit ?? 'MT';
  const differenceAmount = round4(requestedPrice - originalPrice);
  const differencePercent =
    originalPrice === 0 ? 0 : round4((differenceAmount / originalPrice) * 100);
  const qtyFactor = unit.toUpperCase() === 'MT' ? 1000 : 1;
  const totalValue = round4(requestedPrice * quantity * qtyFactor);

  const hasSellerCounter =
    Boolean(meta.counterOfferId) || Boolean(pr?.sellerRespondedAt);
  const responseDeadline = pr?.responseDeadline ?? pr?.expiresAt ?? null;
  const displayStatus = mapSellerPriceRevisionStatus(row.status, {
    responseDeadline,
    hasSellerCounter,
    awaitingBuyer: hasSellerCounter && row.status.toUpperCase() === 'PENDING',
  });

  const grade = item?.grade ?? offer?.grade ?? null;
  const product = item?.product ?? offer?.product ?? null;
  const po = pr?.purchaseOrders?.[0] ?? null;

  const requestNumber =
    (typeof meta.requestNumber === 'string' && meta.requestNumber) ||
    (pr?.referenceNumber
      ? `PRV-${pr.referenceNumber.replace(/^PR-?/i, '')}`
      : `PRV-${row.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`);

  const timeline = (pr?.counterOffers ?? []).map((c) => ({
    id: c.id,
    actorRole: c.createdByRole,
    actorLabel:
      c.createdByRole === 'CUSTOMER'
        ? 'Anonymous Buyer'
        : c.createdByRole === 'ADMIN'
          ? 'Admin'
          : 'Seller',
    unitPrice: toNumber(c.unitPrice),
    quantity: toNumber(c.quantity),
    note: c.note,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
  }));

  return {
    id: row.id,
    requestNumber,
    purchaseRequestId: row.purchaseRequestId,
    offerId: row.offerId,
    purchaseRequestReference: pr?.referenceNumber ?? null,
    orderReference: po?.referenceNumber ?? null,
    status: displayStatus,
    backendStatus: row.status,
    buyer,
    product: product
      ? { id: product.id, code: product.code, name: product.name }
      : null,
    grade: grade
      ? {
          id: grade.id,
          code: grade.code,
          name: grade.name,
          displayName: grade.displayName ?? grade.name,
        }
      : null,
    originalPrice,
    requestedPrice,
    differenceAmount,
    differencePercent,
    quantity,
    unit,
    totalValue,
    currency: row.currency || pr?.currency || offer?.currency || 'INR',
    reason: row.reason,
    paymentMethod: pr?.paymentMethod ?? null,
    deliveryRegion: pr?.destinationRegion ?? null,
    requestedDelivery: pr?.requiredByDate?.toISOString() ?? null,
    requestedOn: row.createdAt.toISOString(),
    requestedAt: row.createdAt.toISOString(),
    responseDeadline: responseDeadline?.toISOString() ?? null,
    deadlineExpired: responseDeadline
      ? responseDeadline.getTime() < Date.now()
      : false,
    allowedActions: resolveAllowedActions(displayStatus, responseDeadline),
    counterPrice:
      typeof meta.counterPrice === 'number'
        ? meta.counterPrice
        : hasSellerCounter
          ? requestedPrice
          : null,
    timeline,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function resolveAllowedActions(
  status: SellerPriceRevisionStatus,
  deadline: Date | null,
): string[] {
  if (deadline && deadline.getTime() < Date.now()) return [];
  if (status === 'PENDING' || status === 'COUNTER_OFFER') {
    return ['ACCEPT', 'REJECT', 'COUNTER'];
  }
  return [];
}

/** Fields that must never appear in seller JSON. */
export { FORBIDDEN_SELLER_IDENTITY_MARKERS } from '../common/blind-buyer.js';
