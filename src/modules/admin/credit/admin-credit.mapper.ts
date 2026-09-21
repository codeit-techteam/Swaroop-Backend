import {
  CreditAccountStatus,
  CreditApplicationStatus,
  CreditStatus,
  type CreditApplication,
  type CreditInsurance,
  type CreditTransaction,
  type CustomerCreditProfile,
  type Document,
  type PaymentSchedule,
  type PurchaseOrder,
} from '../../../generated/prisma/client.js';
import { toDecimal } from '../../payments/common/money.util.js';
import { utilizationPercentage } from '../../payments/services/credit-ledger.service.js';

export const CREDIT_CUSTOMER_SELECT = {
  id: true,
  userId: true,
  organizationId: true,
  creditStatus: true,
  status: true,
  notes: true,
  user: {
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      displayName: true,
    },
  },
  organization: {
    select: {
      id: true,
      name: true,
      legalName: true,
      code: true,
      businessType: true,
      gstin: true,
      pan: true,
      email: true,
      phone: true,
      verificationStatus: true,
    },
  },
} as const;

export type CreditCustomerRecord = {
  id: string;
  userId: string;
  organizationId: string;
  creditStatus: CreditStatus;
  status: string;
  notes: string | null;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
  };
  organization: {
    id: string;
    name: string;
    legalName: string | null;
    code: string | null;
    businessType: string | null;
    gstin: string | null;
    pan: string | null;
    email: string | null;
    phone: string | null;
    verificationStatus: string;
  };
};

function money(value: unknown): string {
  return toDecimal(value as string | number | null).toFixed(2);
}

function actorName(
  user?: {
    firstName?: string | null;
    lastName?: string | null;
    displayName?: string | null;
    email?: string | null;
  } | null,
) {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return user.displayName || name || user.email || null;
}

export function mapCustomerCard(customer: CreditCustomerRecord) {
  return {
    id: customer.id,
    organizationId: customer.organization.id,
    name: customer.organization.legalName ?? customer.organization.name,
    businessType: customer.organization.businessType,
    code: customer.organization.code,
    gstin: customer.organization.gstin,
    pan: customer.organization.pan,
    email: customer.user.email ?? customer.organization.email,
    phone: customer.user.phone ?? customer.organization.phone,
    contactName: actorName(customer.user),
    verificationStatus: customer.organization.verificationStatus,
    creditStatus: customer.creditStatus,
    status: customer.status,
  };
}

export function mapApplication(
  row: CreditApplication & {
    customerProfile: CreditCustomerRecord;
    assignedAdmin?: {
      firstName?: string | null;
      lastName?: string | null;
      displayName?: string | null;
      email?: string | null;
    } | null;
    creditProfile?: Pick<
      CustomerCreditProfile,
      | 'id'
      | 'accountNumber'
      | 'approvedLimit'
      | 'availableLimit'
      | 'outstandingAmount'
    > | null;
  },
  extras?: { documentCount?: number },
) {
  return {
    id: row.id,
    applicationNumber: row.applicationNumber,
    status: row.status as CreditApplicationStatus,
    requestedLimit: money(row.requestedLimit),
    requestedTenureDays: row.requestedTenureDays,
    purpose: row.purpose,
    currency: row.currency,
    assignedAdminId: row.assignedAdminId,
    assignedAdminName: actorName(row.assignedAdmin),
    decidedAt: row.decidedAt,
    decisionReason: row.decisionReason,
    approvedLimit: row.approvedLimit != null ? money(row.approvedLimit) : null,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    documentCount: extras?.documentCount ?? 0,
    existingExposure: money(row.creditProfile?.outstandingAmount ?? 0),
    customer: mapCustomerCard(row.customerProfile),
    creditAccountId: row.creditProfileId,
  };
}

export function mapAccount(
  row: CustomerCreditProfile & {
    customerProfile: CreditCustomerRecord;
    assignedAdmin?: {
      firstName?: string | null;
      lastName?: string | null;
      displayName?: string | null;
      email?: string | null;
    } | null;
    insurance?: CreditInsurance | null;
  },
) {
  return {
    id: row.id,
    accountNumber: row.accountNumber,
    status: row.status as CreditStatus,
    accountStatus: row.accountStatus as CreditAccountStatus,
    requestedLimit:
      row.requestedLimit != null ? money(row.requestedLimit) : null,
    approvedLimit: money(row.approvedLimit),
    availableLimit: money(row.availableLimit),
    utilizedAmount: money(row.utilizedAmount),
    pendingCredit: money(row.pendingCredit),
    outstandingAmount: money(row.outstandingAmount),
    overdueAmount: money(row.overdueAmount),
    utilizationPercentage: utilizationPercentage(
      row.utilizedAmount,
      row.approvedLimit,
    ),
    currency: row.currency,
    creditTermDays: row.creditTermDays,
    approvedAt: row.approvedAt,
    effectiveAt: row.effectiveAt,
    expiresAt: row.expiresAt,
    reviewAt: row.reviewAt,
    assignedAdminId: row.assignedAdminId,
    assignedAdminName: actorName(row.assignedAdmin),
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    customer: mapCustomerCard(row.customerProfile),
    insurance: row.insurance
      ? mapInsurance(row.insurance, row.customerProfile)
      : null,
  };
}

export function mapTransaction(
  row: CreditTransaction & {
    customerProfile?: CreditCustomerRecord;
    creditProfile?: Pick<CustomerCreditProfile, 'id' | 'accountNumber'>;
    createdBy?: {
      firstName?: string | null;
      lastName?: string | null;
      displayName?: string | null;
      email?: string | null;
    } | null;
  },
) {
  return {
    id: row.id,
    transactionNumber: row.transactionNumber,
    creditAccountId: row.creditProfileId,
    accountNumber: row.creditProfile?.accountNumber ?? null,
    customer: row.customerProfile ? mapCustomerCard(row.customerProfile) : null,
    type: row.type,
    status: row.status,
    amount: money(row.amount),
    balanceBefore: row.balanceBefore != null ? money(row.balanceBefore) : null,
    balanceAfter: row.balanceAfter != null ? money(row.balanceAfter) : null,
    currency: row.currency,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    purchaseOrderId: row.purchaseOrderId,
    paymentId: row.paymentId,
    createdBy: actorName(row.createdBy) ?? row.source ?? 'SYSTEM',
    source: row.source,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

export function mapInsurance(
  row: CreditInsurance,
  customer?: CreditCustomerRecord,
) {
  return {
    id: row.id,
    creditAccountId: row.creditProfileId,
    customer: customer ? mapCustomerCard(customer) : null,
    providerName: row.providerName,
    policyNumber: row.policyNumber,
    coverageAmount:
      row.coverageAmount != null ? money(row.coverageAmount) : null,
    status: row.status,
    claimStatus: row.claimStatus,
    startDate: row.startDate,
    endDate: row.endDate,
    notes: row.notes,
    providerIntegration: 'PENDING' as const,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapDocument(
  row: Document & {
    organization?: {
      id: string;
      name: string;
      legalName: string | null;
    } | null;
  },
) {
  const metadata =
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    documentNumber: row.documentNumber,
    fileName: row.fileName,
    category: row.category,
    status: row.status,
    storageKey: row.storageKey,
    storageProvider: row.storageProvider,
    storageConfigured: row.storageProvider !== 'NONE',
    storagePending:
      row.storageProvider === 'NONE' || Boolean(metadata.storagePending),
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    organizationId: row.organizationId,
    organizationName:
      row.organization?.legalName ?? row.organization?.name ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapRepayment(input: {
  schedule: PaymentSchedule;
  purchaseOrder: Pick<
    PurchaseOrder,
    'id' | 'referenceNumber' | 'paymentMethod'
  >;
  customer: CreditCustomerRecord;
  account: Pick<CustomerCreditProfile, 'id' | 'accountNumber'>;
  paidAt: Date | null;
}) {
  const remaining = toDecimal(input.schedule.remainingAmount);
  const dueAt = input.schedule.dueAt;
  let displayStatus = input.schedule.status as string;
  if (
    remaining.greaterThan(0) &&
    dueAt &&
    dueAt.getTime() < Date.now() &&
    input.schedule.status !== 'PAID' &&
    input.schedule.status !== 'WAIVED' &&
    input.schedule.status !== 'CANCELLED'
  ) {
    displayStatus = 'OVERDUE';
  }
  return {
    id: input.schedule.id,
    customer: mapCustomerCard(input.customer),
    creditAccountId: input.account.id,
    accountNumber: input.account.accountNumber,
    purchaseOrderId: input.purchaseOrder.id,
    purchaseOrderNumber: input.purchaseOrder.referenceNumber,
    paymentMethod: input.purchaseOrder.paymentMethod,
    paymentReference: input.purchaseOrder.referenceNumber,
    dueAmount: money(input.schedule.amount),
    paidAmount: money(input.schedule.paidAmount),
    remainingAmount: money(input.schedule.remainingAmount),
    dueDate: input.schedule.dueAt,
    paidDate: input.paidAt,
    status: displayStatus,
    sequence: input.schedule.sequence,
    milestone: input.schedule.milestone,
  };
}

export function mapAuditEvent(row: {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  previousData: unknown;
  newData: unknown;
  createdAt: Date;
  actor?: {
    firstName?: string | null;
    lastName?: string | null;
    displayName?: string | null;
    email?: string | null;
  } | null;
}) {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    previousData: row.previousData,
    newData: row.newData,
    actor: actorName(row.actor) ?? 'SYSTEM',
    createdAt: row.createdAt,
  };
}
