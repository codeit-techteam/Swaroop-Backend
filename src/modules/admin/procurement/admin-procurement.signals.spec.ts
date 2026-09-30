import { describe, expect, it } from 'vitest';
import {
  Priority,
  ProformaInvoiceStatus,
  PurchaseRequestStatus,
} from '../../../generated/prisma/client.js';
import {
  activityMessage,
  csvCell,
  deadlineLabel,
  deriveProcurementAction,
  paymentStatusLabel,
  purchaseRequestStatusLabel,
  type ProcurementSignals,
} from './admin-procurement.signals.js';

const now = new Date('2026-09-28T06:30:00.000Z');

function signals(patch: Partial<ProcurementSignals> = {}): ProcurementSignals {
  return {
    status: PurchaseRequestStatus.SOURCING,
    priority: Priority.NORMAL,
    responseDeadline: null,
    sellerRespondedAt: null,
    hasPurchaseOrder: false,
    piStatus: null,
    piDueDate: null,
    piRemainingAmount: null,
    ...patch,
  };
}

describe('admin procurement signals', () => {
  it('maps backend statuses to operator labels', () => {
    expect(purchaseRequestStatusLabel(PurchaseRequestStatus.NEGOTIATION)).toBe(
      'Negotiation',
    );
    expect(purchaseRequestStatusLabel(PurchaseRequestStatus.APPROVED)).toBe(
      'Commercial Accepted',
    );
    expect(purchaseRequestStatusLabel(PurchaseRequestStatus.SOURCING)).toBe(
      'Pending Seller Response',
    );
  });

  it('flags admin approval without inventing a frontend status', () => {
    const action = deriveProcurementAction(
      signals({ status: PurchaseRequestStatus.PENDING_APPROVAL }),
      now,
    );
    expect(action.actionRequired).toBe(true);
    expect(action.actionType).toBe('ADMIN_APPROVAL_PENDING');
    expect(action.urgent).toBe(false);
  });

  it('uses the server deadline for the seller response window', () => {
    const soon = deriveProcurementAction(
      signals({ responseDeadline: new Date(now.getTime() + 8 * 60_000) }),
      now,
    );
    expect(soon.actionType).toBe('SELLER_RESPONSE_PENDING');
    expect(soon.urgent).toBe(true);
    expect(soon.deadlineLabel).toBe('8m remaining');

    const expired = deriveProcurementAction(
      signals({ responseDeadline: new Date(now.getTime() - 12 * 60_000) }),
      now,
    );
    expect(expired.actionType).toBe('SELLER_RESPONSE_EXPIRED');
    expect(expired.deadlineLabel).toBe('Expired 12m ago');
  });

  it('treats negotiation as an action without marking every open request urgent', () => {
    const action = deriveProcurementAction(
      signals({ status: PurchaseRequestStatus.NEGOTIATION }),
      now,
    );
    expect(action.actionType).toBe('COUNTER_OFFER_AWAITING');
    expect(action.urgent).toBe(false);
  });

  it('derives invoice and payment issues from finance status', () => {
    const missing = deriveProcurementAction(
      signals({
        status: PurchaseRequestStatus.CONVERTED_TO_ORDER,
        hasPurchaseOrder: true,
        piStatus: null,
      }),
      now,
    );
    expect(missing.actionType).toBe('PI_NOT_GENERATED');

    const overdue = deriveProcurementAction(
      signals({
        status: PurchaseRequestStatus.CONVERTED_TO_ORDER,
        hasPurchaseOrder: true,
        piStatus: ProformaInvoiceStatus.EXPIRED,
        piRemainingAmount: '125000.00',
      }),
      now,
    );
    expect(overdue.actionType).toBe('PAYMENT_ISSUE');
    expect(overdue.urgent).toBe(true);
    expect(
      paymentStatusLabel({
        piStatus: ProformaInvoiceStatus.PARTIALLY_PAID,
        piRemainingAmount: '10.00',
      }),
    ).toBe('Partially Paid');
  });

  it('does not require action on closed requests', () => {
    const action = deriveProcurementAction(
      signals({
        status: PurchaseRequestStatus.REJECTED,
        priority: Priority.URGENT,
      }),
      now,
    );
    expect(action.actionRequired).toBe(false);
    expect(action.urgent).toBe(false);
  });

  it('formats activity and csv cells', () => {
    expect(activityMessage('SELLER_ACCEPTED', 'PR-202609-000123')).toBe(
      'Seller accepted · PR-202609-000123',
    );
    expect(deadlineLabel(new Date(now.getTime() + 2 * 3_600_000), now)).toBe(
      '2h remaining',
    );
    expect(csvCell('ABC, "Industries"')).toBe('"ABC, ""Industries"""');
  });
});
