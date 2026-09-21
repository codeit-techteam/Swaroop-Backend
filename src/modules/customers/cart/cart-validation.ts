export type CartValidationIssue = {
  cartItemId: string;
  code: string;
  message: string;
  currentUnitPrice?: number;
};

export type CartPriceChange = {
  cartItemId: string;
  productId: string;
  productName: string;
  gradeName: string | null;
  oldUnitPrice: number;
  newUnitPrice: number;
  quantity: number;
  unit: string;
};

export type CartValidationStatus = 'OK' | 'PRICE_CHANGED' | 'INVALID';

export const CART_BLOCKING_ISSUE_CODES = new Set([
  'CART_EMPTY',
  'OFFER_NOT_FOUND',
  'OFFER_NOT_ACTIVE',
  'OFFER_EXPIRED',
  'PRODUCT_NOT_AVAILABLE',
  'QUANTITY_BELOW_MOQ',
  'QUANTITY_EXCEEDS_AVAILABILITY',
  'INSUFFICIENT_INVENTORY',
  'MOQ_NOT_MET',
  'INVALID_QUANTITY',
  'INVALID_QUANTITY_INCREMENT',
  'INVALID',
]);

export function classifyCartValidation(
  issues: Array<Pick<CartValidationIssue, 'code'>>,
  changes: CartPriceChange[] = [],
): CartValidationStatus {
  if (issues.some((issue) => CART_BLOCKING_ISSUE_CODES.has(issue.code))) {
    return 'INVALID';
  }
  if (
    changes.length > 0 ||
    issues.some((issue) => issue.code === 'PRICE_CHANGED')
  ) {
    return 'PRICE_CHANGED';
  }
  return 'OK';
}

export function isCartCheckoutReady(status: CartValidationStatus): boolean {
  return status === 'OK' || status === 'PRICE_CHANGED';
}
