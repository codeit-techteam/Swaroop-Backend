import { describe, expect, it } from 'vitest';
import {
  SELLER_ACCESS_DENY,
  assertAssignablePermissions,
  assertPasswordStrength,
  normalizeIndianMobile,
  permissionForManagerRequest,
} from './seller-access.js';

describe('seller manager access', () => {
  it('rejects admin permissions', () => {
    expect(() => assertAssignablePermissions(['USER_WRITE'])).toThrow(
      /not assignable/,
    );
  });

  it('accepts seller panel permissions', () => {
    expect(assertAssignablePermissions(['orders.view', 'orders.view'])).toEqual(
      ['orders.view', 'profile.view'],
    );
  });

  it('normalizes Indian mobiles and rejects others', () => {
    expect(normalizeIndianMobile('9000000000')).toBe('+919000000000');
    expect(normalizeIndianMobile('+91 90000 00000')).toBe('+919000000000');
    expect(() => normalizeIndianMobile('12345')).toThrow(/Indian mobile/);
  });

  it('requires a letter and a number in passwords', () => {
    expect(() => assertPasswordStrength('short')).toThrow(/8/);
    expect(() => assertPasswordStrength('password')).toThrow(/uppercase/);
    expect(() => assertPasswordStrength('Manager1')).not.toThrow();
  });

  it('maps seller routes to permissions and denies other sellers and admin', () => {
    expect(permissionForManagerRequest('GET', '/api/v1/seller/orders')).toBe(
      'orders.view',
    );
    expect(
      permissionForManagerRequest('POST', '/api/v1/seller/dispatches'),
    ).toBe('logistics.manage');
    expect(
      permissionForManagerRequest('GET', '/api/v1/seller/onboarding'),
    ).toBe(SELLER_ACCESS_DENY);
    expect(permissionForManagerRequest('GET', '/api/v1/admin/users')).toBe(
      SELLER_ACCESS_DENY,
    );
    expect(permissionForManagerRequest('GET', '/api/v1/customer/orders')).toBe(
      SELLER_ACCESS_DENY,
    );
    expect(
      permissionForManagerRequest('POST', '/api/v1/seller/orders/abc'),
    ).toBe('orders.manage');
  });
});
