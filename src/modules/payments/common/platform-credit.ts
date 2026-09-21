import { PaymentMethod } from '../../../generated/prisma/client.js';

export const PLATFORM_CREDIT_METHODS: PaymentMethod[] = [
  PaymentMethod.CREDIT,
  PaymentMethod.CREDIT_15,
  PaymentMethod.CREDIT_30,
];

export const CREDIT_SOURCE = 'PETROTRADE / SWAROOP CREDIT MANAGEMENT';

export type PlatformCreditSellerStatus =
  | 'PLATFORM_CREDIT_APPROVED'
  | 'PLATFORM_CREDIT_PENDING'
  | 'PLATFORM_CREDIT_BLOCKED';

const SELLER_CREDIT_PRICING_KEYS = [
  'creditPrice',
  'sellerCreditPrice',
  'creditPricing',
  'creditInterest',
  'sellerCreditInterest',
  'sellerCreditTerms',
  'creditRate',
  'customerCreditRate',
  'interestRate',
  'interestRateBps',
] as const;

export function isPlatformCredit(
  method: PaymentMethod | string | null | undefined,
): boolean {
  return (
    method === PaymentMethod.CREDIT ||
    method === PaymentMethod.CREDIT_15 ||
    method === PaymentMethod.CREDIT_30 ||
    method === 'CREDIT'
  );
}

export function sellerPlatformCreditStatus(input: {
  paymentMethod?: PaymentMethod | string | null;
  reserved?: boolean;
  accountActive?: boolean | null;
}): PlatformCreditSellerStatus | null {
  if (!isPlatformCredit(input.paymentMethod)) return null;
  if (input.accountActive === false) return 'PLATFORM_CREDIT_BLOCKED';
  if (input.reserved) return 'PLATFORM_CREDIT_APPROVED';
  return 'PLATFORM_CREDIT_PENDING';
}

export function sanitizeSellerPaymentTerms(
  value?: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      SELLER_CREDIT_PRICING_KEYS.includes(
        key as (typeof SELLER_CREDIT_PRICING_KEYS)[number],
      )
    ) {
      continue;
    }
    next[key] = entry;
  }
  return next;
}

export function hasSellerCreditPricing(
  value?: Record<string, unknown> | null,
): boolean {
  if (!value) return false;
  return SELLER_CREDIT_PRICING_KEYS.some((key) => key in value);
}

export function isSellerCreditPriceTier(
  paymentMethod?: PaymentMethod | string | null,
): boolean {
  return isPlatformCredit(paymentMethod);
}
