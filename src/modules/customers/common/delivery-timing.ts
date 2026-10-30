/**
 * Shared marketplace delivery / dispatch timing helpers.
 * Used by customer listing payloads and seller listing create/update so ETA
 * stays consistent across Customer App, Customer Web, Seller, and Admin.
 */

export const DEFAULT_DISPATCH_WINDOW = '24 Hours';

export type DeliveryEstimateSource = 'SELLER_TERMS' | 'CALCULATED';
export type DispatchWindowSource = 'OFFER_METADATA' | 'PLATFORM_DEFAULT';

/**
 * True when the string is a transit / dispatch timeline (e.g. "2–3 Days"),
 * not an Incoterm or delivery location ("Ex-works Mumbai", "FOR Ahmedabad").
 */
export function isDeliveryTimingLabel(value?: string | null): boolean {
  const v = (value ?? '').trim();
  if (!v) return false;
  if (/^(ex[\s-]?works|exw|fob|cif|for|dap|ddp|c&f)\b/i.test(v)) return false;
  if (/\b(same\s*day|next\s*day)\b/i.test(v)) return true;
  return /(\d+\s*[-–to]+\s*\d+|\d+)\s*(business\s*)?(day|days|hour|hours|hr|hrs|week|weeks)\b/i.test(
    v,
  );
}

/**
 * Blind-marketplace-safe ETA label from warehouse / origin geography.
 * Same bands used when sellers create marketplace listings.
 */
export function estimateDeliveryTerms(locationHint?: string | null): string {
  const hint = (locationHint ?? '').toLowerCase();
  if (
    hint.includes('mumbai') ||
    hint.includes('pune') ||
    hint.includes('nashik') ||
    hint.includes('bhiwandi') ||
    hint.includes('gujarat') ||
    hint.includes('ahmedabad') ||
    hint.includes('vadodara') ||
    hint.includes('surat')
  ) {
    return '2–3 Business Days';
  }
  if (
    hint.includes('chennai') ||
    hint.includes('kolkata') ||
    hint.includes('howrah') ||
    hint.includes('delhi') ||
    hint.includes('noida') ||
    hint.includes('gurgaon') ||
    hint.includes('gurugram') ||
    hint.includes('hyderabad') ||
    hint.includes('bangalore') ||
    hint.includes('bengaluru') ||
    hint.includes('panipat')
  ) {
    return '3–5 Business Days';
  }
  return '4–6 Business Days';
}

/** @deprecated Prefer estimateDeliveryTerms — kept for legacy call sites. */
export function estimateLeadTime(locationHint?: string | null): string {
  return estimateDeliveryTerms(locationHint);
}

export function resolveDeliveryEstimate(input: {
  deliveryTerms?: string | null;
  locationHint?: string | null;
}): { label: string; source: DeliveryEstimateSource } {
  const terms = input.deliveryTerms?.trim() || null;
  if (terms && isDeliveryTimingLabel(terms)) {
    return { label: terms, source: 'SELLER_TERMS' };
  }
  return {
    label: estimateDeliveryTerms(input.locationHint),
    source: 'CALCULATED',
  };
}

export function resolveDispatchWindow(label?: string | null): {
  label: string;
  source: DispatchWindowSource;
} {
  const trimmed = label?.trim() || null;
  if (trimmed) {
    return { label: trimmed, source: 'OFFER_METADATA' };
  }
  return {
    label: DEFAULT_DISPATCH_WINDOW,
    source: 'PLATFORM_DEFAULT',
  };
}
