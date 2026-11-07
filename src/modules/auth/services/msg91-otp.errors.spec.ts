import { describe, expect, it } from 'vitest';
import {
  classifyMsg91Failure,
  maskPhoneForLog,
} from './msg91-otp.errors.js';

describe('maskPhoneForLog', () => {
  it('masks Indian E.164 numbers', () => {
    expect(maskPhoneForLog('+918240890242')).toBe('+91******0242');
  });

  it('masks digit-only MSG91 mobiles', () => {
    expect(maskPhoneForLog('918240890242')).toBe('+91******0242');
  });
});

describe('classifyMsg91Failure', () => {
  it('detects authkey and IP whitelist failures', () => {
    expect(classifyMsg91Failure('Invalid authkey', '201')).toBe(
      'INVALID_AUTHKEY',
    );
    expect(classifyMsg91Failure('IP not whitelisted')).toBe(
      'IP_NOT_WHITELISTED',
    );
  });

  it('detects template and balance failures', () => {
    expect(classifyMsg91Failure('Invalid template id')).toBe(
      'INVALID_TEMPLATE',
    );
    expect(classifyMsg91Failure('Insufficient balance')).toBe(
      'INSUFFICIENT_BALANCE',
    );
  });
});
