import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '../../../generated/prisma/client.js';
import { FinanceException } from './finance.errors.js';

const ALLOWED: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.INITIATED]: [
    PaymentStatus.SUBMITTED,
    PaymentStatus.CANCELLED,
    PaymentStatus.FAILED,
  ],
  [PaymentStatus.PENDING]: [
    PaymentStatus.SUBMITTED,
    PaymentStatus.UNDER_VERIFICATION,
    PaymentStatus.CANCELLED,
    PaymentStatus.FAILED,
  ],
  [PaymentStatus.AUTHORIZED]: [
    PaymentStatus.SUBMITTED,
    PaymentStatus.UNDER_VERIFICATION,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.SUBMITTED]: [
    PaymentStatus.UNDER_VERIFICATION,
    PaymentStatus.REJECTED,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.UNDER_VERIFICATION]: [
    PaymentStatus.VERIFIED,
    PaymentStatus.REJECTED,
    PaymentStatus.PAID,
  ],
  [PaymentStatus.VERIFIED]: [
    PaymentStatus.PAID,
    PaymentStatus.PARTIALLY_PAID,
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
  ],
  [PaymentStatus.PARTIALLY_PAID]: [
    PaymentStatus.PAID,
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
  ],
  [PaymentStatus.PAID]: [
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
  ],
  [PaymentStatus.FAILED]: [PaymentStatus.INITIATED, PaymentStatus.CANCELLED],
  [PaymentStatus.REFUNDED]: [],
  [PaymentStatus.PARTIALLY_REFUNDED]: [
    PaymentStatus.REFUNDED,
    PaymentStatus.PARTIALLY_REFUNDED,
  ],
  [PaymentStatus.CANCELLED]: [],
  [PaymentStatus.OVERDUE]: [
    PaymentStatus.SUBMITTED,
    PaymentStatus.UNDER_VERIFICATION,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.REJECTED]: [PaymentStatus.INITIATED, PaymentStatus.CANCELLED],
};

@Injectable()
export class PaymentStateService {
  assertTransition(from: PaymentStatus, to: PaymentStatus): void {
    if (from === to) return;
    const allowed = ALLOWED[from] ?? [];
    if (!allowed.includes(to)) {
      throw new FinanceException(
        'INVALID_PAYMENT_TRANSITION',
        `Cannot transition payment from ${from} to ${to}`,
      );
    }
  }

  canCustomerMutate(status: PaymentStatus): boolean {
    return (
      status === PaymentStatus.INITIATED ||
      status === PaymentStatus.PENDING ||
      status === PaymentStatus.SUBMITTED ||
      status === PaymentStatus.REJECTED
    );
  }
}
