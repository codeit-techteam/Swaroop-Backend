import { add, round2, toDecimal } from '../common/money.util.js';
import { utilizationPercentage } from './credit-ledger.service.js';

describe('credit ledger math', () => {
  it('computes utilization from Decimal values without JS float drift', () => {
    expect(utilizationPercentage('18000000', '50000000')).toBe('36.00');
    expect(utilizationPercentage(0, '1000')).toBe('0.00');
    expect(utilizationPercentage('10', 0)).toBe('0.00');
  });

  it('adds money with 2dp rounding', () => {
    expect(add('10.105', '0.005').toFixed(2)).toBe('10.11');
    expect(round2(toDecimal('1.005')).toFixed(2)).toBe('1.01');
  });
});
