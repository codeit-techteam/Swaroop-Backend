/**
 * Seller Manager permissions use the same codes the Seller Web navigation
 * already understands. Admin-only codes are not in this catalog.
 */

export const SELLER_ACCESS_DENY = 'DENY';

export type SellerPermissionDef = {
  code: string;
  module: string;
  action: string;
};

export const SELLER_MANAGER_PERMISSIONS: SellerPermissionDef[] = [
  { code: 'dashboard.view', module: 'Dashboard', action: 'View' },
  { code: 'catalog.view', module: 'My Products', action: 'View' },
  { code: 'catalog.manage', module: 'My Products', action: 'Create / Edit' },
  { code: 'inventory.view', module: 'Inventory', action: 'View' },
  { code: 'inventory.manage', module: 'Inventory', action: 'Create / Edit' },
  { code: 'offers.view', module: 'My Offers', action: 'View' },
  { code: 'offers.manage', module: 'My Offers', action: 'Create / Edit' },
  { code: 'import.view', module: 'Import Trading', action: 'View' },
  {
    code: 'import.manage',
    module: 'Import Trading',
    action: 'Create / Publish / Negotiate',
  },
  { code: 'procurement.view', module: 'Purchase Requests', action: 'View' },
  {
    code: 'procurement.manage',
    module: 'Purchase Requests',
    action: 'Respond / Update',
  },
  { code: 'orders.view', module: 'Orders', action: 'View' },
  { code: 'orders.manage', module: 'Orders', action: 'Update' },
  { code: 'logistics.view', module: 'Dispatch & Shipments', action: 'View' },
  {
    code: 'logistics.manage',
    module: 'Dispatch & Shipments',
    action: 'Create / Update',
  },
  { code: 'finance.view', module: 'Finance', action: 'View' },
  { code: 'finance.manage', module: 'Finance', action: 'Edit / Approve' },
  { code: 'compliance.view', module: 'Documents', action: 'View' },
  { code: 'compliance.manage', module: 'Documents', action: 'Upload' },
  { code: 'profile.view', module: 'Profile', action: 'View' },
  { code: 'profile.manage', module: 'Profile', action: 'Edit' },
  { code: 'support.view', module: 'Support', action: 'View' },
  { code: 'support.manage', module: 'Support', action: 'Create' },
];

const ASSIGNABLE = new Set(SELLER_MANAGER_PERMISSIONS.map((item) => item.code));

export const SELLER_OWNER_PERMISSIONS = SELLER_MANAGER_PERMISSIONS.map(
  (item) => item.code,
);

export const MANAGER_PRESETS: Record<string, { label: string; permissions: string[] }> =
  {
    OPERATIONS: {
      label: 'Operations Manager',
      permissions: [
        'dashboard.view',
        'catalog.view',
        'catalog.manage',
        'inventory.view',
        'inventory.manage',
        'offers.view',
        'offers.manage',
        'import.view',
        'procurement.view',
        'procurement.manage',
        'orders.view',
        'orders.manage',
        'logistics.view',
        'logistics.manage',
      ],
    },
    SALES: {
      label: 'Sales Manager',
      permissions: [
        'dashboard.view',
        'catalog.view',
        'offers.view',
        'offers.manage',
        'import.view',
        'import.manage',
        'procurement.view',
        'procurement.manage',
        'orders.view',
      ],
    },
    FINANCE: {
      label: 'Finance Manager',
      permissions: [
        'dashboard.view',
        'orders.view',
        'finance.view',
        'finance.manage',
        'compliance.view',
      ],
    },
    LOGISTICS: {
      label: 'Logistics Manager',
      permissions: [
        'dashboard.view',
        'orders.view',
        'inventory.view',
        'logistics.view',
        'logistics.manage',
      ],
    },
    FULL: {
      label: 'Full Seller Manager',
      permissions: [...SELLER_OWNER_PERMISSIONS],
    },
  };

export function assertAssignablePermissions(codes: string[]): string[] {
  const unique = [...new Set(codes.map((code) => code.trim()).filter(Boolean))];
  const rejected = unique.filter((code) => !ASSIGNABLE.has(code));
  if (rejected.length) {
    throw new Error(
      `Permissions are not assignable to a Seller Manager: ${rejected.join(', ')}`,
    );
  }
  if (!unique.includes('dashboard.view') && !unique.includes('profile.view')) {
    unique.push('profile.view');
  }
  return unique;
}

export function normalizeIndianMobile(input: string): string {
  const digits = input.replace(/\D/g, '');
  const local =
    digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits.length === 10
        ? digits
        : '';
  if (!/^[6-9]\d{9}$/.test(local)) {
    throw new Error('Enter a valid 10-digit Indian mobile number');
  }
  return `+91${local}`;
}

export function assertPasswordStrength(password: string): void {
  if (password.length < 8 || password.length > 128) {
    throw new Error('Password must be 8 to 128 characters');
  }
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/.test(password)) {
    throw new Error(
      'Password must include uppercase, lowercase, and a number',
    );
  }
}

export function splitDisplayName(name: string): {
  firstName: string;
  lastName: string | null;
  displayName: string;
} {
  const displayName = name.trim().replace(/\s+/g, ' ');
  const parts = displayName.split(' ');
  return {
    displayName,
    firstName: parts[0] ?? displayName,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
}

/**
 * Permission required for a Seller Manager on this HTTP request.
 * Seller owners never call this. Unknown seller surfaces are denied.
 */
export function permissionForManagerRequest(method: string, url: string): string {
  const path = url.split('?')[0]?.toLowerCase() ?? '';
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());

  if (path.includes('/admin/') || path.includes('/customer/')) {
    return SELLER_ACCESS_DENY;
  }
  if (path.includes('/seller/onboarding')) return SELLER_ACCESS_DENY;
  if (path.includes('/master-data/') && !path.includes('/import/')) {
    return write ? SELLER_ACCESS_DENY : 'catalog.view';
  }

  const rule = (view: string, manage: string) => (write ? manage : view);

  if (/\/v\d+\/import(\/|$)/.test(path)) {
    return rule('import.view', 'import.manage');
  }
  if (!path.includes('/seller')) return SELLER_ACCESS_DENY;

  if (path.includes('/dashboard') || path.includes('dashboard-summary')) {
    return 'dashboard.view';
  }
  if (path.includes('/products')) return rule('catalog.view', 'catalog.manage');
  if (path.includes('/inventory')) {
    return rule('inventory.view', 'inventory.manage');
  }
  if (path.includes('/offers')) return rule('offers.view', 'offers.manage');
  if (
    path.includes('/purchase-requests') ||
    path.includes('/procurement')
  ) {
    return rule('procurement.view', 'procurement.manage');
  }
  if (path.includes('/orders')) return rule('orders.view', 'orders.manage');
  if (
    path.includes('/dispatches') ||
    path.includes('/shipments') ||
    path.includes('/deliveries') ||
    path.includes('/vehicles') ||
    path.includes('/drivers') ||
    path.includes('/vehicle-slots') ||
    path.includes('/logistics')
  ) {
    return rule('logistics.view', 'logistics.manage');
  }
  if (
    path.includes('/payments') ||
    path.includes('/settlements') ||
    path.includes('/finance') ||
    path.includes('/proforma') ||
    path.includes('/price-revisions') ||
    path.includes('/pricing') ||
    path.includes('/purchase-orders')
  ) {
    return rule('finance.view', 'finance.manage');
  }
  if (path.includes('/documents')) {
    return rule('compliance.view', 'compliance.manage');
  }
  if (path.includes('/support')) return rule('support.view', 'support.manage');
  if (path.includes('/notifications') || path.includes('/cms')) {
    return 'dashboard.view';
  }
  if (
    path.includes('/profile') ||
    path.includes('/status') ||
    path.includes('/company') ||
    path.includes('/locations') ||
    path.includes('/addresses')
  ) {
    return rule('profile.view', 'profile.manage');
  }
  return SELLER_ACCESS_DENY;
}
