import { describe, expect, it } from 'vitest';
import { resolveDisplayReference } from './notification.service.js';

describe('resolveDisplayReference', () => {
  it('returns human-readable business references', () => {
    expect(
      resolveDisplayReference({ referenceNumber: 'PO-2026-000123' }),
    ).toBe('PO-2026-000123');
    expect(resolveDisplayReference({ ticketNumber: 'TKT-42' })).toBe('TKT-42');
    expect(
      resolveDisplayReference({ applicationNumber: 'CR-APP-9' }),
    ).toBe('CR-APP-9');
  });

  it('never returns raw UUIDs', () => {
    expect(
      resolveDisplayReference({
        reference: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
      }),
    ).toBeNull();
    expect(
      resolveDisplayReference({
        entityId: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
      }),
    ).toBeNull();
  });

  it('prefers displayReference over other keys', () => {
    expect(
      resolveDisplayReference({
        displayReference: 'INV-100',
        referenceNumber: 'PO-200',
      }),
    ).toBe('INV-100');
  });
});
