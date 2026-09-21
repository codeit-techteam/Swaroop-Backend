import { Injectable } from '@nestjs/common';
import {
  PaymentMethod,
  PaymentScheduleStatus,
  PaymentScheduleType,
  Prisma,
  type PaymentSchedule,
  type PurchaseOrder,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { FinanceException } from '../common/finance.errors.js';
import {
  add,
  cmp,
  isZero,
  round2,
  splitByPercentages,
  sub,
  toDecimal,
} from '../common/money.util.js';
import { ScheduleStateService } from '../common/schedule-state.service.js';

type TxClient = Prisma.TransactionClient;

type ScheduleTemplateLine = {
  type: PaymentScheduleType;
  pct: number;
  status: PaymentScheduleStatus;
  dueAt?: Date | null;
  milestone?: string | null;
};

@Injectable()
export class PaymentScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleState: ScheduleStateService,
  ) {}

  buildTemplate(
    method: PaymentMethod | null | undefined,
    now = new Date(),
  ): ScheduleTemplateLine[] {
    switch (method) {
      case PaymentMethod.ADVANCE:
        return [
          {
            type: PaymentScheduleType.ADVANCE,
            pct: 100,
            status: PaymentScheduleStatus.DUE,
          },
        ];
      case PaymentMethod.BEFORE_DISPATCH:
        return [
          {
            type: PaymentScheduleType.BEFORE_DISPATCH,
            pct: 100,
            status: PaymentScheduleStatus.DUE,
          },
        ];
      case PaymentMethod.ON_LOADING:
        return [
          {
            type: PaymentScheduleType.ON_LOADING,
            pct: 100,
            status: PaymentScheduleStatus.PENDING,
          },
        ];
      case PaymentMethod.ON_DELIVERY:
        return [
          {
            type: PaymentScheduleType.ON_DELIVERY,
            pct: 100,
            status: PaymentScheduleStatus.PENDING,
          },
        ];
      case PaymentMethod.CREDIT:
        return [
          {
            type: PaymentScheduleType.CREDIT,
            pct: 100,
            status: PaymentScheduleStatus.DUE,
            dueAt: addDays(now, 30),
          },
        ];
      case PaymentMethod.CREDIT_15:
        return [
          {
            type: PaymentScheduleType.CREDIT,
            pct: 100,
            status: PaymentScheduleStatus.DUE,
            dueAt: addDays(now, 15),
          },
        ];
      case PaymentMethod.CREDIT_30:
        return [
          {
            type: PaymentScheduleType.CREDIT,
            pct: 100,
            status: PaymentScheduleStatus.DUE,
            dueAt: addDays(now, 30),
          },
        ];
      case PaymentMethod.PARTIAL_ADVANCE:
      case PaymentMethod.PARTIAL_PAYMENT:
        return [
          {
            type: PaymentScheduleType.ADVANCE,
            pct: 30,
            status: PaymentScheduleStatus.DUE,
            milestone: 'partial_advance',
          },
          {
            type: PaymentScheduleType.BEFORE_DISPATCH,
            pct: 70,
            status: PaymentScheduleStatus.PENDING,
            milestone: 'before_dispatch_balance',
          },
        ];
      case PaymentMethod.MILESTONE_PAYMENT:
        return [
          {
            type: PaymentScheduleType.ADVANCE,
            pct: 20,
            status: PaymentScheduleStatus.DUE,
            milestone: 'milestone_advance',
          },
          {
            type: PaymentScheduleType.ON_LOADING,
            pct: 40,
            status: PaymentScheduleStatus.PENDING,
            milestone: 'milestone_loading',
          },
          {
            type: PaymentScheduleType.ON_DELIVERY,
            pct: 40,
            status: PaymentScheduleStatus.PENDING,
            milestone: 'milestone_delivery',
          },
        ];
      case PaymentMethod.NET_TERMS:
      case PaymentMethod.LC:
      case PaymentMethod.OTHER:
      default:
        return [
          {
            type: PaymentScheduleType.OTHER,
            pct: 100,
            status: PaymentScheduleStatus.DUE,
          },
        ];
    }
  }

  async createFromPo(
    tx: TxClient,
    purchaseOrder: PurchaseOrder,
    proformaInvoiceId: string,
    totalAmount: Prisma.Decimal | number | string,
  ): Promise<PaymentSchedule[]> {
    const existing = await tx.paymentSchedule.findMany({
      where: { purchaseOrderId: purchaseOrder.id },
      orderBy: { sequence: 'asc' },
    });
    if (existing.length > 0) {
      return existing;
    }

    const now = new Date();
    const template = this.buildTemplate(purchaseOrder.paymentMethod, now);
    const amounts = splitByPercentages(
      totalAmount,
      template.map((t) => t.pct),
    );

    const created: PaymentSchedule[] = [];
    for (let i = 0; i < template.length; i++) {
      const line = template[i];
      const amount = amounts[i];
      const row = await tx.paymentSchedule.create({
        data: {
          purchaseOrderId: purchaseOrder.id,
          proformaInvoiceId,
          sequence: i + 1,
          type: line.type,
          percentage: line.pct,
          amount,
          paidAmount: 0,
          remainingAmount: amount,
          currency: purchaseOrder.currency,
          dueAt: line.dueAt ?? null,
          status: line.status,
          milestone: line.milestone ?? null,
          metadata: {
            percentage: line.pct,
            paymentMethod: purchaseOrder.paymentMethod,
          } as Prisma.InputJsonValue,
        },
      });
      created.push(row);
    }
    return created;
  }

  /** Phase 9 hook: mark a schedule type as DUE for a PO. */
  async markPaymentMilestoneDue(
    poId: string,
    type: PaymentScheduleType,
    tx?: TxClient,
  ): Promise<PaymentSchedule | null> {
    return this.markDue(poId, type, tx);
  }

  async markDue(
    poId: string,
    type: PaymentScheduleType,
    tx?: TxClient,
  ): Promise<PaymentSchedule | null> {
    const client = tx ?? this.prisma;
    const schedule = await client.paymentSchedule.findFirst({
      where: {
        purchaseOrderId: poId,
        type,
        status: {
          in: [PaymentScheduleStatus.PENDING, PaymentScheduleStatus.OVERDUE],
        },
      },
      orderBy: { sequence: 'asc' },
    });
    if (!schedule) return null;

    this.scheduleState.assertTransition(
      schedule.status,
      PaymentScheduleStatus.DUE,
    );

    return client.paymentSchedule.update({
      where: { id: schedule.id },
      data: {
        status: PaymentScheduleStatus.DUE,
        dueAt: schedule.dueAt ?? new Date(),
      },
    });
  }

  async applyVerifiedPayment(
    tx: TxClient,
    scheduleId: string,
    amount: Prisma.Decimal | number | string,
  ): Promise<PaymentSchedule> {
    const schedule = await tx.paymentSchedule.findUnique({
      where: { id: scheduleId },
    });
    if (!schedule) {
      throw new FinanceException(
        'PAYMENT_SCHEDULE_NOT_FOUND',
        'Payment schedule not found',
      );
    }

    const payAmount = round2(amount);
    if (cmp(payAmount, 0) <= 0) {
      throw new FinanceException(
        'PAYMENT_AMOUNT_INVALID',
        'Verified amount must be positive',
      );
    }
    if (cmp(payAmount, schedule.remainingAmount) > 0) {
      throw new FinanceException(
        'PAYMENT_OVERPAYMENT',
        'Verified amount exceeds schedule remaining',
      );
    }

    const paidAmount = add(schedule.paidAmount, payAmount);
    const remainingAmount = sub(schedule.remainingAmount, payAmount);
    const nextStatus = isZero(remainingAmount)
      ? PaymentScheduleStatus.PAID
      : PaymentScheduleStatus.PARTIALLY_PAID;

    if (
      schedule.status !== nextStatus &&
      schedule.status !== PaymentScheduleStatus.PARTIALLY_PAID
    ) {
      this.scheduleState.assertTransition(schedule.status, nextStatus);
    }

    return tx.paymentSchedule.update({
      where: { id: scheduleId },
      data: {
        paidAmount,
        remainingAmount,
        status: nextStatus,
      },
    });
  }

  /**
   * Dispatch-blocking when ADVANCE / BEFORE_DISPATCH (and metadata.dispatchBlocking)
   * schedules still have remaining amount.
   */
  async isPaymentClearedForDispatch(poId: string): Promise<{
    cleared: boolean;
    blockingSchedules: Array<{
      id: string;
      type: PaymentScheduleType;
      remainingAmount: string;
      status: PaymentScheduleStatus;
    }>;
  }> {
    const schedules = await this.prisma.paymentSchedule.findMany({
      where: { purchaseOrderId: poId },
      orderBy: { sequence: 'asc' },
    });

    const blocking = schedules.filter((s) => {
      if (isZero(s.remainingAmount)) return false;
      if (
        s.type === PaymentScheduleType.ADVANCE ||
        s.type === PaymentScheduleType.BEFORE_DISPATCH
      ) {
        return true;
      }
      const meta = s.metadata as { dispatchBlocking?: boolean } | null;
      return meta?.dispatchBlocking === true;
    });

    return {
      cleared: blocking.length === 0,
      blockingSchedules: blocking.map((s) => ({
        id: s.id,
        type: s.type,
        remainingAmount: toDecimal(s.remainingAmount).toFixed(2),
        status: s.status,
      })),
    };
  }
}

function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
