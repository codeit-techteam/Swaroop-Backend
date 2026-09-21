import { describe, expect, it } from 'vitest';
import {
  haversineMeters,
  isDuplicateAddress,
  normalizePincode,
} from './addresses.mapper.js';

describe('customer address mapper', () => {
  it('normalizes pincodes to six digits', () => {
    expect(normalizePincode('400 001')).toBe('400001');
    expect(normalizePincode('110001')).toBe('110001');
  });

  it('detects duplicates by line and pincode', () => {
    expect(
      isDuplicateAddress(
        { line1: 'Plot 12, MIDC', postalCode: '400093' },
        { line1: 'plot 12,  midc', postalCode: '400093' },
      ),
    ).toBe(true);
  });

  it('detects nearby GPS coordinates as the same address', () => {
    expect(
      isDuplicateAddress(
        {
          line1: 'Current location',
          postalCode: '400053',
          latitude: 19.119,
          longitude: 72.846,
        },
        {
          line1: 'Andheri West',
          postalCode: '400053',
          latitude: 19.1191,
          longitude: 72.8461,
        },
      ),
    ).toBe(true);
    expect(haversineMeters(19.119, 72.846, 19.2, 72.9)).toBeGreaterThan(50);
  });
});
