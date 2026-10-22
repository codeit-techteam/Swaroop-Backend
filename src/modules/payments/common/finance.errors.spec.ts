import { describe, expect, it } from 'vitest';
import { FINANCE_ERROR_CODES, FinanceException } from './finance.errors.js';

describe('FinanceException', () => {
  it('includes INVOICE_NOT_FOUND as a 404 finance error', () => {
    expect(FINANCE_ERROR_CODES).toContain('INVOICE_NOT_FOUND');
    const err = new FinanceException('INVOICE_NOT_FOUND');
    expect(err.code).toBe('INVOICE_NOT_FOUND');
    expect(err.getStatus()).toBe(404);
  });
});
