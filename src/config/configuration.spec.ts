import { describe, expect, it } from 'vitest';
import { normalizeSurepassBaseUrl } from './configuration.js';

describe('normalizeSurepassBaseUrl', () => {
  it('adds the /api/v1 prefix to a bare Surepass host', () => {
    expect(normalizeSurepassBaseUrl('https://kyc-api.surepass.app')).toBe(
      'https://kyc-api.surepass.app/api/v1',
    );
    expect(normalizeSurepassBaseUrl(' https://kyc-api.surepass.app/ ')).toBe(
      'https://kyc-api.surepass.app/api/v1',
    );
  });

  it('keeps an explicit path and strips trailing slashes', () => {
    expect(
      normalizeSurepassBaseUrl('https://kyc-api.surepass.app/api/v1/'),
    ).toBe('https://kyc-api.surepass.app/api/v1');
    expect(normalizeSurepassBaseUrl('https://sandbox.surepass.app/v2')).toBe(
      'https://sandbox.surepass.app/v2',
    );
  });

  it('returns an empty string when unset', () => {
    expect(normalizeSurepassBaseUrl(undefined)).toBe('');
    expect(normalizeSurepassBaseUrl('   ')).toBe('');
  });
});
