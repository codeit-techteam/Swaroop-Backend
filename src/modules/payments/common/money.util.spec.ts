import { describe, expect, it } from 'vitest';
import { PaymentMethod, Prisma } from '../../../generated/prisma/client.js';
import { add, cmp, round2, splitByPercentages, sub } from './money.util.js';
import { PaymentScheduleService } from '../services/payment-schedule.service.js';

describe('money.util', () => {
  it('round2 and arithmetic avoid float drift', () => {
    expect(round2('10.005').toFixed(2)).toBe('10.01');
    expect(add(10.1, 0.2).toFixed(2)).toBe('10.30');
    expect(sub(100, 33.33).toFixed(2)).toBe('66.67');
    expect(cmp(1, 2)).toBe(-1);
  });

  it('splitByPercentages last line absorbs remainder', () => {
    const parts = splitByPercentages(100, [30, 70]);
    expect(parts[0].toFixed(2)).toBe('30.00');
    expect(parts[1].toFixed(2)).toBe('70.00');

    const awkward = splitByPercentages(
      new Prisma.Decimal('100.00'),
      [33.3333, 33.3333, 33.3334],
    );
    const sum = awkward.reduce((acc, v) => acc.plus(v), new Prisma.Decimal(0));
    expect(sum.toFixed(2)).toBe('100.00');
  });
});

describe('PaymentScheduleService templates', () => {
  const service = new PaymentScheduleService(
    {} as never,
    { assertTransition: () => undefined } as never,
  );

  it('builds PARTIAL_ADVANCE 30/70', () => {
    const lines = service.buildTemplate(PaymentMethod.PARTIAL_ADVANCE);
    expect(lines.map((l) => l.pct)).toEqual([30, 70]);
    expect(lines[0].status).toBe('DUE');
    expect(lines[1].status).toBe('PENDING');
  });

  it('builds MILESTONE_PAYMENT 20/40/40', () => {
    const lines = service.buildTemplate(PaymentMethod.MILESTONE_PAYMENT);
    expect(lines.map((l) => l.pct)).toEqual([20, 40, 40]);
  });

  it('builds BEFORE_DISPATCH', () => {
    const lines = service.buildTemplate(PaymentMethod.BEFORE_DISPATCH);
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('BEFORE_DISPATCH');
    expect(lines[0].status).toBe('DUE');
  });
});
