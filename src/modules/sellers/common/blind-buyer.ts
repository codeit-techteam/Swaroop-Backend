import { createHash } from 'node:crypto';

/** Seller-facing blind marketplace buyer label — never a real customer name. */
export const BLIND_BUYER_DISPLAY_NAME = 'Anonymous Buyer' as const;

export const FORBIDDEN_SELLER_IDENTITY_MARKERS = [
  'customerId',
  'customerOrgId',
  'customerProfileId',
  'customerName',
  'customerCompanyName',
  'companyName',
  'legalName',
  'buyerName',
  'buyerId',
  'buyerCompany',
  'gstin',
  'GSTIN',
  'billingAddress',
  'shippingAddress',
  'customerOrg',
  'customerProfile',
] as const;

export function anonymousBuyer(customerOrgId: string) {
  return {
    displayName: BLIND_BUYER_DISPLAY_NAME,
    reference: `BUYER-${createHash('sha256')
      .update(customerOrgId)
      .digest('hex')
      .slice(0, 8)
      .toUpperCase()}`,
  };
}

/**
 * Fail fast if a seller DTO accidentally serializes customer identity keys.
 * Does not scan free-text values (notes/errors) — only JSON property names.
 */
export function assertBlindSellerPayload(
  payload: unknown,
  label = 'Seller payload',
): void {
  const walk = (value: unknown, path: string): void => {
    if (value == null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (
        (FORBIDDEN_SELLER_IDENTITY_MARKERS as readonly string[]).includes(key)
      ) {
        throw new Error(`${label} must not expose ${key} at ${path}.${key}`);
      }
      // email/phone as property names on nested objects are also forbidden
      if (key === 'email' || key === 'phone') {
        throw new Error(`${label} must not expose ${key} at ${path}.${key}`);
      }
      walk(child, path ? `${path}.${key}` : key);
    }
  };
  walk(payload, 'root');
}
