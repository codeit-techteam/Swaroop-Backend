import { describe, expect, it } from 'vitest';
import {
  composeMobile,
  normalizePhoneE164,
  toMsg91Mobile,
} from './phone.util.js';

describe('normalizePhoneE164', () => {
  it('accepts E.164, 10-digit, and 91-prefixed forms', () => {
    expect(normalizePhoneE164('+918240890242')).toBe('+918240890242');
    expect(normalizePhoneE164('8240890242')).toBe('+918240890242');
    expect(normalizePhoneE164('918240890242')).toBe('+918240890242');
    expect(normalizePhoneE164('91 82408 90242')).toBe('+918240890242');
  });

  it('rejects double-prefixed 9191… by recovering the local 10 digits', () => {
    expect(normalizePhoneE164('91918240890242')).toBe('+918240890242');
  });

  it('rejects invalid lengths', () => {
    expect(() => normalizePhoneE164('12345')).toThrow(/valid mobile/);
  });
});

describe('composeMobile', () => {
  it('builds E.164 from mobile + country code without double prefix', () => {
    expect(composeMobile('8240890242', '+91')).toBe('+918240890242');
    expect(composeMobile('+918240890242')).toBe('+918240890242');
  });
});

describe('toMsg91Mobile', () => {
  it('strips plus for MSG91', () => {
    expect(toMsg91Mobile('+918240890242')).toBe('918240890242');
    expect(toMsg91Mobile('8240890242')).toBe('918240890242');
  });
});
