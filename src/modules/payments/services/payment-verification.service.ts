import { Injectable } from '@nestjs/common';
import {
  FinanceTransactionStatus,
  PaymentScheduleStatus,
  PaymentStatus,
  Prisma,
  ProformaInvoiceStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { FinanceEventsService } from '../common/finance-events.service.js';
import { FinanceException } from '../common/finance.errors.js';
import { isZero, toDecimal } from '../common/money.util.js';
import { PaymentStateService } from '../common/payment-state.service.js';
import { FinanceInvoiceService } from './finance-invoice.service.js';
import { PaymentScheduleService } from './payment-schedule.service.js';
import { ProformaInvoiceService } from './proforma-invoice.service.js';
import { SettlementService } from './settlement.service.js';

@Injectable()
export class PaymentVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentState: PaymentStateService,
    private readonly schedules: PaymentScheduleService,
    private readonly proformas: ProformaInvoiceService,
    private readonly financeInvoices: FinanceInvoiceService,
    private readonly settlements: SettlementService,
    private readonly events: FinanceEventsService,
  ) {}

  async verify(paymentId: string, adminUserId: string, note?: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!payment) throw new FinanceException('PAYMENT_NOT_FOUND');

    this.paymentState.assertTransition(payment.status, PaymentStatus.VERIFIED);

    if (payment.status !== PaymentStatus.UNDER_VERIFICATION) {
      throw new FinanceException(
        'PAYMENT_NOT_UNDER_VERIFICATION',
        'Payment must be UNDER_VERIFICATION to verify',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.payment.updateMany({
        where: {
          id: paymentId,
          status: PaymentStatus.UNDER_VERIFICATION,
        },
        data: {
          status: PaymentStatus.VERIFIED,
          paidAmount: payment.amount,
          pendingAmount: 0,
          verifiedAt: new Date(),
          verifiedById: adminUserId,
        },
      });

      if (updated.count !== 1) {
        throw new FinanceException('PAYMENT_ALREADY_VERIFIED');
      }

      await tx.paymentStatusHistory.create({
        data: {
          paymentId,
          fromStatus: PaymentStatus.UNDER_VERIFICATION,
          toStatus: PaymentStatus.VERIFIED,
          notes: note ?? 'Verified by admin',
        },
      });

      const txn = payment.transactions[0];
      if (txn) {
        await tx.paymentTransaction.update({
          where: { id: txn.id },
          data: {
            status: FinanceTransactionStatus.SUCCESS,
            processedAt: new Date(),
          },
        });
      }

      if (payment.paymentScheduleId) {
        await this.schedules.applyVerifiedPayment(
          tx,
          payment.paymentScheduleId,
          payment.amount,
        );
      }

      let pi = null;
      if (payment.proformaInvoiceId) {
        pi = await this.proformas.applyVerifiedPayment(
          tx,
          payment.proformaInvoiceId,
          payment.amount,
        );
      }

      const po = payment.purchaseOrderId
        ? await tx.purchaseOrder.findUnique({
            where: { id: payment.purchaseOrderId },
          })
        : null;

      if (po) {
        await this.financeInvoices.createDraft(
          tx,
          po,
          payment.proformaInvoiceId,
        );

        const schedules = await tx.paymentSchedule.findMany({
          where: { purchaseOrderId: po.id },
        });
        const allPaid =
          schedules.length > 0 &&
          schedules.every((s) => s.status === PaymentScheduleStatus.PAID);
        const piPaid =
          pi?.status === ProformaInvoiceStatus.PAID ||
          (pi ? isZero(pi.remainingAmount) : false);

        if (allPaid && piPaid) {
          await this.settlements.createPendingDraft(tx, po, {
            paymentId: payment.id,
          });
        }
      }

      await this.events.record(tx, {
        purchaseOrderId: payment.purchaseOrderId,
        paymentId: payment.id,
        eventType: 'PAYMENT_VERIFIED',
        actorRole: 'ADMIN',
        actorUserId: adminUserId,
        metadata: {
          amount: toDecimal(payment.amount).toFixed(2),
          note: note ?? null,
        },
      });

      return tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: {
          transactions: true,
          organization: {
            select: { id: true, name: true, legalName: true },
          },
          sellerOrg: {
            select: { id: true, name: true, legalName: true },
          },
        },
      });
    });

    return result;
  }

  async reject(paymentId: string, adminUserId: string, reason?: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!payment) throw new FinanceException('PAYMENT_NOT_FOUND');

    this.paymentState.assertTransition(payment.status, PaymentStatus.REJECTED);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payment.updateMany({
        where: {
          id: paymentId,
          status: {
            in: [PaymentStatus.UNDER_VERIFICATION, PaymentStatus.SUBMITTED],
          },
        },
        data: {
          status: PaymentStatus.REJECTED,
          failureReason: reason ?? 'Rejected by admin',
          pendingAmount: 0,
        },
      });
      if (updated.count !== 1) {
        throw new FinanceException(
          'INVALID_PAYMENT_STATUS',
          'Payment is not in a rejectable state',
        );
      }

      await tx.paymentStatusHistory.create({
        data: {
          paymentId,
          fromStatus: payment.status,
          toStatus: PaymentStatus.REJECTED,
          notes: reason ?? 'Rejected by admin',
        },
      });

      const txn = payment.transactions[0];
      if (txn) {
        await tx.paymentTransaction.update({
          where: { id: txn.id },
          data: { status: FinanceTransactionStatus.FAILED },
        });
      }

      await this.events.record(tx, {
        purchaseOrderId: payment.purchaseOrderId,
        paymentId: payment.id,
        eventType: 'PAYMENT_REJECTED',
        actorRole: 'ADMIN',
        actorUserId: adminUserId,
        metadata: { reason: reason ?? null },
      });

      return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    });
  }

  async requestReview(paymentId: string, adminUserId: string, note?: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new FinanceException('PAYMENT_NOT_FOUND');

    await this.events.record(this.prisma, {
      purchaseOrderId: payment.purchaseOrderId,
      paymentId: payment.id,
      eventType: 'PAYMENT_REVIEW_REQUESTED',
      actorRole: 'ADMIN',
      actorUserId: adminUserId,
      metadata: { note: note ?? null } as Prisma.InputJsonValue,
    });

    return {
      id: payment.id,
      status: payment.status,
      reviewRequested: true,
    };
  }
}
