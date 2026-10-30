import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPATCH_WINDOW,
  estimateDeliveryTerms,
  isDeliveryTimingLabel,
  resolveDeliveryEstimate,
  resolveDispatchWindow,
} from './delivery-timing.js';

describe('delivery timing', () => {
  it('recognises transit labels and rejects Incoterms', () => {
    expect(isDeliveryTimingLabel('2–3 Business Days')).toBe(true);
    expect(isDeliveryTimingLabel('24 Hours')).toBe(true);
    expect(isDeliveryTimingLabel('Ex-works Mumbai')).toBe(false);
    expect(isDeliveryTimingLabel('FOR Ahmedabad')).toBe(false);
  });

  it('estimates ETA from warehouse geography', () => {
    expect(estimateDeliveryTerms('Bhiwandi Hub')).toBe('2–3 Business Days');
    expect(estimateDeliveryTerms('Chennai CFS')).toBe('3–5 Business Days');
    expect(estimateDeliveryTerms('Unknown Depot')).toBe('4–6 Business Days');
  });

  it('prefers seller timing terms when present', () => {
    expect(
      resolveDeliveryEstimate({
        deliveryTerms: '3–5 Days',
        locationHint: 'Mumbai',
      }),
    ).toEqual({ label: '3–5 Days', source: 'SELLER_TERMS' });
  });

  it('calculates when deliveryTerms is an Incoterm', () => {
    expect(
      resolveDeliveryEstimate({
        deliveryTerms: 'Ex-works Mumbai',
        locationHint: 'Mumbai',
      }),
    ).toEqual({ label: '2–3 Business Days', source: 'CALCULATED' });
  });

  it('defaults dispatch window to 24 Hours', () => {
    expect(resolveDispatchWindow(null)).toEqual({
      label: DEFAULT_DISPATCH_WINDOW,
      source: 'PLATFORM_DEFAULT',
    });
    expect(resolveDispatchWindow('48 Hours')).toEqual({
      label: '48 Hours',
      source: 'OFFER_METADATA',
    });
  });
});
