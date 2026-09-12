import { createHash } from 'node:crypto';
import type { NegotiationActorRole } from '../../../generated/prisma/client.js';

/**
 * Strip buyer identity for blind marketplace seller views.
 */
export function toBlindPurchaseRequest(
  pr: {
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
    notes: string | null;
    expiresAt: Date | null;
    responseDeadline?: Date | null;
    submittedAt: Date | null;
    createdAt: Date;
    viewedBySellerAt: Date | null;
    customerOrgId: string;
    commerciallyAcceptedAt?: Date | null;
    items?: Array<{
      id: string;
      quantity: unknown;
      unit: string;
      packaging: string | null;
      notes: string | null;
      targetUnitPrice: unknown;
      grade?: {
        id: string;
        code: string;
        name: string;
        displayName: string | null;
      } | null;
      product?: { id: string; code: string; name: string } | null;
    }>;
    responses?: unknown[];
    purchaseOrders?: Array<{
      referenceNumber: string;
      status: string;
    }>;
  },
  extras?: {
    remainingSeconds?: number | null;
    allowedActions?: string[];
    latestCounterRole?: NegotiationActorRole | null;
  },
) {
  const deadline = pr.responseDeadline ?? pr.expiresAt ?? null;
  const po = pr.purchaseOrders?.[0];

  return {
    id: pr.id,
    referenceNumber: pr.referenceNumber,
    status: pr.status,
    priority: pr.priority,
    buyer: {
      displayName: 'ANONYMOUS BUYER',
      reference: `BUYER-${createHash('sha256')
        .update(pr.customerOrgId)
        .digest('hex')
        .slice(0, 8)
        .toUpperCase()}`,
    },
    paymentMethod: pr.paymentMethod,
    targetPrice: pr.targetPrice,
    currency: pr.currency,
    requiredByDate: pr.requiredByDate,
    destinationRegion: pr.destinationRegion,
    deliveryLocationRegion:
      pr.destinationRegion ?? maskLocation(pr.deliveryLocation),
    notes: pr.notes,
    expiresAt: pr.expiresAt,
    responseDeadline: deadline,
    remainingSeconds:
      extras?.remainingSeconds ??
      (deadline
        ? Math.max(0, Math.floor((deadline.getTime() - Date.now()) / 1000))
        : null),
    allowedActions: extras?.allowedActions ?? [],
    submittedAt: pr.submittedAt,
    createdAt: pr.createdAt,
    viewedBySellerAt: pr.viewedBySellerAt,
    commerciallyAcceptedAt: pr.commerciallyAcceptedAt ?? null,
    purchaseOrder: po
      ? { referenceNumber: po.referenceNumber, status: po.status }
      : null,
    items: (pr.items ?? []).map((item) => ({
      id: item.id,
      quantity: item.quantity,
      unit: item.unit,
      packaging: item.packaging,
      notes: item.notes,
      targetUnitPrice: item.targetUnitPrice,
      grade: item.grade
        ? {
            id: item.grade.id,
            code: item.grade.code,
            name: item.grade.name,
            displayName: item.grade.displayName ?? item.grade.name,
          }
        : null,
      product: item.product
        ? {
            id: item.product.id,
            code: item.product.code,
            name: item.product.name,
          }
        : null,
    })),
    responses: pr.responses ?? [],
  };
}

function maskLocation(value: string | null): string | null {
  if (!value) return null;
  if (value.length > 40) {
    return `${value.slice(0, 24)}…`;
  }
  return value;
}
