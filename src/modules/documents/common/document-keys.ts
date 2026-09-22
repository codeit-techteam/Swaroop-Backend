import { randomUUID } from 'node:crypto';
import { DocumentCategory } from '../../../generated/prisma/client.js';

/** Sanitize original filename for use as a storage key segment (never alone as the key). */
export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop()?.trim() || 'file';
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return safe.slice(0, 180) || 'file';
}

/** Collision-safe object key leaf: `{uuid}-{sanitizedOriginal}`. */
export function buildCollisionSafeLeaf(
  fileName: string,
  objectId?: string,
): string {
  const id = objectId ?? randomUUID();
  return `${id}-${sanitizeFileName(fileName)}`;
}

export function buildCustomerKycKey(
  profileId: string,
  documentId: string,
  fileName: string,
): string {
  return `customers/${profileId}/kyc/${documentId}/${buildCollisionSafeLeaf(fileName, documentId)}`;
}

export function buildSellerDocumentKey(
  profileId: string,
  category: DocumentCategory | string,
  documentId: string,
  fileName: string,
): string {
  const cat = String(category)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_');
  return `sellers/${profileId}/${cat}/${documentId}/${buildCollisionSafeLeaf(fileName, documentId)}`;
}

export function buildPaymentProofKey(
  paymentId: string,
  documentId: string,
  fileName: string,
): string {
  return `payments/${paymentId}/proof/${documentId}/${buildCollisionSafeLeaf(fileName, documentId)}`;
}

export function buildDispatchEwayBillKey(
  dispatchId: string,
  documentId: string,
  fileName: string,
): string {
  return `dispatches/${dispatchId}/eway-bill/${documentId}/${buildCollisionSafeLeaf(fileName, documentId)}`;
}

export function buildDeliveryPodKey(
  deliveryId: string,
  documentId: string,
  fileName: string,
): string {
  return `deliveries/${deliveryId}/pod/${documentId}/${buildCollisionSafeLeaf(fileName, documentId)}`;
}

export function buildPurchaseOrderDocumentKey(
  purchaseOrderId: string,
  documentId: string,
  fileName: string,
): string {
  return `purchase-orders/${purchaseOrderId}/documents/${documentId}/${buildCollisionSafeLeaf(fileName, documentId)}`;
}

/**
 * Product document keys never include seller identity.
 * Path: products/{productId}/documents/{documentId}/version-{n}.{ext}
 */
export function buildProductDocumentKey(
  productId: string,
  documentId: string,
  fileName: string,
  version = 1,
): string {
  const ext =
    sanitizeFileName(fileName).split('.').pop()?.toLowerCase() || 'bin';
  const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
  return `products/${productId}/documents/${documentId}/version-${version}.${safeExt}`;
}

export type BuildStorageKeyInput = {
  documentId: string;
  fileName: string;
  category: DocumentCategory;
  customerProfileId?: string;
  sellerProfileId?: string;
  productId?: string;
  documentVersion?: number;
  paymentId?: string;
  dispatchId?: string;
  deliveryId?: string;
  purchaseOrderId?: string;
};

/**
 * Build a collision-safe storage key for the given domain context.
 * Prefer the most specific related entity when provided.
 */
export function buildStorageKey(input: BuildStorageKeyInput): string {
  const { documentId, fileName, category } = input;

  if (input.productId) {
    return buildProductDocumentKey(
      input.productId,
      documentId,
      fileName,
      input.documentVersion ?? 1,
    );
  }
  if (input.paymentId) {
    return buildPaymentProofKey(input.paymentId, documentId, fileName);
  }
  if (input.dispatchId) {
    return buildDispatchEwayBillKey(input.dispatchId, documentId, fileName);
  }
  if (input.deliveryId) {
    return buildDeliveryPodKey(input.deliveryId, documentId, fileName);
  }
  if (input.purchaseOrderId) {
    return buildPurchaseOrderDocumentKey(
      input.purchaseOrderId,
      documentId,
      fileName,
    );
  }
  if (input.customerProfileId) {
    if (category === DocumentCategory.KYC) {
      return buildCustomerKycKey(input.customerProfileId, documentId, fileName);
    }
    return `customers/${input.customerProfileId}/${String(category).toLowerCase()}/${documentId}/${buildCollisionSafeLeaf(fileName, documentId)}`;
  }
  if (input.sellerProfileId) {
    return buildSellerDocumentKey(
      input.sellerProfileId,
      category,
      documentId,
      fileName,
    );
  }

  return `documents/${documentId}/${buildCollisionSafeLeaf(fileName, documentId)}`;
}
