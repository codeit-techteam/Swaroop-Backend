import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { PurchaseOrderStatus } from '../../../generated/prisma/client.js';
import { safeRate } from './analytics-format.js';
import { resolveAnalyticsPeriod } from './analytics-period.js';
import { GMV_PO_STATUSES } from './gmv.constants.js';

describe('analytics period', () => {
  it('defaults to current UTC month when from/to omitted', () => {
    const period = resolveAnalyticsPeriod();
    expect(period.defaultApplied).toBe(true);
    expect(period.from.getUTCDate()).toBe(1);
    expect(period.from.getTime()).toBeLessThanOrEqual(period.to.getTime());
  });

  it('rejects from > to', () => {
    expect(() => resolveAnalyticsPeriod('2026-09-12', '2026-09-01')).toThrow(
      BadRequestException,
    );
  });
});

describe('analytics rates', () => {
  it('returns 0 for zero denominator', () => {
    expect(safeRate(5, 0, true)).toBe(0);
    expect(safeRate(0, 0)).toBe(0);
  });

  it('computes percent safely', () => {
    expect(safeRate(1, 4, true)).toBe(25);
  });
});

describe('GMV statuses', () => {
  it('excludes cancelled and draft', () => {
    expect(GMV_PO_STATUSES).not.toContain(PurchaseOrderStatus.CANCELLED);
    expect(GMV_PO_STATUSES).not.toContain(PurchaseOrderStatus.DRAFT);
    expect(GMV_PO_STATUSES).toContain(PurchaseOrderStatus.CONFIRMED);
    expect(GMV_PO_STATUSES).toContain(PurchaseOrderStatus.COMPLETED);
  });
});
