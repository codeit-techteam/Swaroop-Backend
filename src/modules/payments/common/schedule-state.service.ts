import { Injectable } from '@nestjs/common';
import { PaymentScheduleStatus } from '../../../generated/prisma/client.js';
import { FinanceException } from './finance.errors.js';

const ALLOWED: Record<PaymentScheduleStatus, PaymentScheduleStatus[]> = {
  [PaymentScheduleStatus.PENDING]: [
    PaymentScheduleStatus.DUE,
    PaymentScheduleStatus.WAIVED,
    PaymentScheduleStatus.CANCELLED,
  ],
  [PaymentScheduleStatus.DUE]: [
    PaymentScheduleStatus.PARTIALLY_PAID,
    PaymentScheduleStatus.PAID,
    PaymentScheduleStatus.OVERDUE,
    PaymentScheduleStatus.WAIVED,
    PaymentScheduleStatus.CANCELLED,
  ],
  [PaymentScheduleStatus.PARTIALLY_PAID]: [
    PaymentScheduleStatus.PAID,
    PaymentScheduleStatus.OVERDUE,
    PaymentScheduleStatus.WAIVED,
  ],
  [PaymentScheduleStatus.PAID]: [],
  [PaymentScheduleStatus.OVERDUE]: [
    PaymentScheduleStatus.PARTIALLY_PAID,
    PaymentScheduleStatus.PAID,
    PaymentScheduleStatus.WAIVED,
    PaymentScheduleStatus.CANCELLED,
  ],
  [PaymentScheduleStatus.WAIVED]: [],
  [PaymentScheduleStatus.CANCELLED]: [],
};

@Injectable()
export class ScheduleStateService {
  assertTransition(
    from: PaymentScheduleStatus,
    to: PaymentScheduleStatus,
  ): void {
    if (from === to) return;
    const allowed = ALLOWED[from] ?? [];
    if (!allowed.includes(to)) {
      throw new FinanceException(
        'INVALID_PAYMENT_TRANSITION',
        `Cannot transition schedule from ${from} to ${to}`,
      );
    }
  }
}
