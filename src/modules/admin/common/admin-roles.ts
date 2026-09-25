import { RoleCode } from '../../../common/enums/domain.enums.js';

export const ADMIN_CORE_ROLES = [RoleCode.ADMIN, RoleCode.SUPER_ADMIN] as const;

export const ADMIN_FINANCE_ROLES = [
  RoleCode.ADMIN,
  RoleCode.SUPER_ADMIN,
  RoleCode.FINANCE_MANAGER,
] as const;

export const ADMIN_OPS_ROLES = [
  RoleCode.ADMIN,
  RoleCode.SUPER_ADMIN,
  RoleCode.OPERATIONS_MANAGER,
] as const;

export const ADMIN_COMPLIANCE_ROLES = [
  RoleCode.ADMIN,
  RoleCode.SUPER_ADMIN,
  RoleCode.COMPLIANCE_MANAGER,
] as const;

export const ADMIN_SUPPORT_ROLES = [
  RoleCode.ADMIN,
  RoleCode.SUPER_ADMIN,
  RoleCode.OPERATIONS_MANAGER,
] as const;
