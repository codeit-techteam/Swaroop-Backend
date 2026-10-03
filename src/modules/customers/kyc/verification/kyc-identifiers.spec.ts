import { describe, expect, it } from 'vitest';
import {
  hashIdentifier,
  isValidGstin,
  isValidPan,
  maskGstin,
  maskPan,
  normalizeIdentifier,
  panFromGstin,
} from './kyc-identifiers.js';

describe('kyc identifiers', () => {
  it('validates PAN format', () => {
    expect(isValidPan('AAPFU0939F')).toBe(true);
    expect(isValidPan('AAPFU0939')).toBe(false);
    expect(isValidPan('aapfu0939f')).toBe(false);
  });

  it('validates the GSTIN check digit, not just the shape', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('29AAGCB7383J1Z4')).toBe(true);
    expect(isValidGstin('27AAPFU0939F1ZX')).toBe(false);
    expect(isValidGstin('27AAPFU0939F1Z')).toBe(false);
  });

  it('extracts the PAN embedded in a GSTIN', () => {
    expect(panFromGstin('27AAPFU0939F1ZV')).toBe('AAPFU0939F');
  });

  it('masks identifiers without leaking the middle characters', () => {
    expect(maskPan('AAPFU0939F')).toBe('AA•••••39F');
    expect(maskGstin('27AAPFU0939F1ZV')).toBe('27AA•••••••F1ZV');
  });

  it('hashes normalized identifiers per type', () => {
    expect(hashIdentifier('PAN', ' aapfu0939f ')).toBe(
      hashIdentifier('PAN', 'AAPFU0939F'),
    );
    expect(hashIdentifier('PAN', 'AAPFU0939F')).not.toBe(
      hashIdentifier('GST', 'AAPFU0939F'),
    );
    expect(normalizeIdentifier('27 aapfu 0939f1zv')).toBe('27AAPFU0939F1ZV');
  });
});
