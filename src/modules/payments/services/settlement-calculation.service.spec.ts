import { describe, expect, it } from 'vitest';
import { SettlementCalculationService } from './settlement-calculation.service.js';

describe('SettlementCalculationService', () => {
  const calc = new SettlementCalculationService();

  it('computes full payment net with Indian 2-decimal rounding', () => {
    const result = calc.calculate({
      grossAmount: '100000.005',
      taxAmount: '18000',
      platformFee: '500',
      tdsAmount: '1180',
      deductions: '0',
    });
    expect(result.grossAmount.toFixed(2)).toBe('100000.01');
    expect(result.taxAmount.toFixed(2)).toBe('18000.00');
    expect(result.platformFee.toFixed(2)).toBe('500.00');
    expect(result.tdsAmount.toFixed(2)).toBe('1180.00');
    expect(result.netAmount.toFixed(2)).toBe('116320.01');
  });

  it('handles zero fees (configured default)', () => {
    const result = calc.calculate({
      grossAmount: 10000,
      taxAmount: 1800,
    });
    expect(result.platformFee.toFixed(2)).toBe('0.00');
    expect(result.tdsAmount.toFixed(2)).toBe('0.00');
    expect(result.netAmount.toFixed(2)).toBe('11800.00');
  });

  it('applies refund-style deductions without double-counting', () => {
    const result = calc.calculate({
      grossAmount: 50000,
      taxAmount: 9000,
      platformFee: 250,
      tdsAmount: 590,
      deductions: 10000,
    });
    expect(result.netAmount.toFixed(2)).toBe('48160.00');
  });

  it('handles cancelled/failed style zero settlement', () => {
    const result = calc.calculate({
      grossAmount: 0,
      taxAmount: 0,
      platformFee: 0,
      tdsAmount: 0,
      deductions: 0,
    });
    expect(result.netAmount.toFixed(2)).toBe('0.00');
  });

  it('supports multiple settlement lines via summed deductions', () => {
    const lineA = calc.calculate({
      grossAmount: 20000,
      taxAmount: 3600,
      platformFee: 100,
    });
    const lineB = calc.calculate({
      grossAmount: 10000,
      taxAmount: 1800,
      platformFee: 50,
      deductions: 500,
    });
    const combinedNet = Number(lineA.netAmount) + Number(lineB.netAmount);
    expect(combinedNet.toFixed(2)).toBe('34750.00');
  });

  it('does not invent amounts when inputs are partial', () => {
    const result = calc.calculate({
      grossAmount: '2500.5',
      taxAmount: '0',
      platformFee: '0',
      tdsAmount: '0',
    });
    expect(result.netAmount.toFixed(2)).toBe('2500.50');
  });
});
