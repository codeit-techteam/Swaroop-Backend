import { Injectable } from '@nestjs/common';
import {
  FinanceTransactionStatus,
  FinanceTransactionType,
  PaymentRail,
  PaymentScheduleStatus,
  PaymentStatus,
  Prisma,
  ProformaInvoiceStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { REFERENCE_NUMBER_PREFIX } from '../../../common/enums/domain.enums.js';
import { FinanceEventsService } from '../common/finance-events.service.js';
import { FinanceException } from '../common/finance.errors.js';
import { cmp, isPositive, round2, toDecimal } from '../common/money.util.js';
import { PaymentStateService } from '../common/payment-state.service.js';

export type CreatePaymentInput = {
  customerOrgId: string;
  actorUserId: string;
  purchaseOrderId: string;
  paymentScheduleId?: string;
  amount: number | string;
  rail: PaymentRail;
  note?: string;
  idempotencyKey?: string;
};

export type SubmitUtrInput = {
  utrNumber: string;
  paymentDate?: string;
  note?: string;
  amount?: number | string;
};

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentState: PaymentStateService,
    private readonly events: FinanceEventsService,
  ) {}

  nextPaymentRef(now = new Date()): string {
    const year = now.getFullYear();
    const seq = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0');
    return `${REFERENCE_NUMBER_PREFIX.PAYMENT}-${year}-${seq}`;
  }

  nextTxnRef(now = new Date()): string {
    const year = now.getFullYear();
    const seq = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0');
    return `TXN-${year}-${seq}`;
  }

  async create(input: CreatePaymentInput) {
    if (input.idempotencyKey) {
      const existing = await this.prisma.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { transactions: true },
      });
      if (existing) {
        if (existing.organizationId !== input.customerOrgId) {
          throw new FinanceException('IDEMPOTENCY_CONFLICT');
        }
        return this.toCustomerView(existing);
      }
    }

    const amount = round2(input.amount);
    if (!isPositive(amount)) {
      throw new FinanceException(
        'PAYMENT_AMOUNT_INVALID',
        'Payment amount must be greater than zero',
      );
    }

    const po = await this.prisma.purchaseOrder.findFirst({
      where: {
        id: input.purchaseOrderId,
        deletedAt: null,
        customerOrgId: input.customerOrgId,
      },
    });
    if (!po) {
      throw new FinanceException('PURCHASE_ORDER_NOT_FOUND');
    }

    const pi = await this.prisma.proformaInvoice.findUnique({
      where: { purchaseOrderId: po.id },
    });
    if (!pi) {
      throw new FinanceException('PROFORMA_NOT_FOUND');
    }
    if (pi.status === ProformaInvoiceStatus.CANCELLED) {
      throw new FinanceException('PROFORMA_CANCELLED');
    }

    const schedule = input.paymentScheduleId
      ? await this.prisma.paymentSchedule.findFirst({
          where: {
            id: input.paymentScheduleId,
            purchaseOrderId: po.id,
          },
        })
      : await this.prisma.paymentSchedule.findFirst({
          where: {
            purchaseOrderId: po.id,
            status: {
              in: [
                PaymentScheduleStatus.DUE,
                PaymentScheduleStatus.PARTIALLY_PAID,
              ],
            },
          },
          orderBy: { sequence: 'asc' },
        });

    if (!schedule) {
      throw new FinanceException(
        'PAYMENT_SCHEDULE_NOT_FOUND',
        'No due payment schedule found for this purchase order',
      );
    }

    if (cmp(amount, schedule.remainingAmount) > 0) {
      throw new FinanceException(
        'INSUFFICIENT_SCHEDULE_REMAINING',
        `Amount exceeds schedule remaining (${toDecimal(schedule.remainingAmount).toFixed(2)})`,
      );
    }
    if (cmp(amount, pi.remainingAmount) > 0) {
      throw new FinanceException('PAYMENT_OVERPAYMENT');
    }

    if (!po.paymentMethod) {
      throw new FinanceException(
        'PAYMENT_AMOUNT_INVALID',
        'Purchase order has no payment method',
      );
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      let created: Awaited<
        ReturnType<Prisma.TransactionClient['payment']['create']>
      > | null = null;

      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          created = await tx.payment.create({
            data: {
              referenceNumber: this.nextPaymentRef(),
              purchaseOrderId: po.id,
              proformaInvoiceId: pi.id,
              paymentScheduleId: schedule!.id,
              organizationId: input.customerOrgId,
              sellerOrgId: po.sellerOrgId,
              method: po.paymentMethod!,
              rail: input.rail,
              status: PaymentStatus.INITIATED,
              currency: po.currency,
              amount,
              paidAmount: 0,
              pendingAmount: amount,
              metadata: {
                note: input.note ?? null,
                proofDocumentId: null,
              } as Prisma.InputJsonValue,
              idempotencyKey: input.idempotencyKey ?? undefined,
              statusHistory: {
                create: {
                  toStatus: PaymentStatus.INITIATED,
                  notes: 'Payment initiated by customer',
                },
              },
              transactions: {
                create: {
                  transactionReference: this.nextTxnRef(),
                  purchaseOrderId: po.id,
                  proformaInvoiceId: pi.id,
                  amount,
                  currency: po.currency,
                  rail: input.rail,
                  transactionType: FinanceTransactionType.PAYMENT,
                  status: FinanceTransactionStatus.CREATED,
                },
              },
            },
            include: { transactions: true },
          });
          break;
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            const target =
              (err.meta?.target as string[] | string | undefined) ?? [];
            const fields = Array.isArray(target) ? target : [String(target)];
            if (fields.some((f) => String(f).includes('idempotency'))) {
              const raced = await tx.payment.findUnique({
                where: { idempotencyKey: input.idempotencyKey! },
                include: { transactions: true },
              });
              if (raced) return raced;
            }
            continue;
          }
          throw err;
        }
      }

      if (!created) {
        throw new FinanceException(
          'PAYMENT_NOT_FOUND',
          'Failed to create payment',
        );
      }

      await this.events.record(tx, {
        purchaseOrderId: po.id,
        paymentId: created.id,
        eventType: 'PAYMENT_INITIATED',
        actorRole: 'CUSTOMER',
        actorUserId: input.actorUserId,
        metadata: {
          amount: amount.toFixed(2),
          scheduleId: schedule!.id,
          rail: input.rail,
        },
      });

      return created;
    });

    return this.toCustomerView(payment);
  }

  async submit(
    paymentId: string,
    customerOrgId: string,
    actorUserId: string,
    input: SubmitUtrInput,
  ) {
    return this.submitUtr(paymentId, customerOrgId, actorUserId, input);
  }

  async submitUtr(
    paymentId: string,
    customerOrgId: string,
    actorUserId: string,
    input: SubmitUtrInput,
  ) {
    const utr = input.utrNumber?.trim();
    if (!utr) {
      throw new FinanceException('UTR_REQUIRED');
    }

    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, organizationId: customerOrgId },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!payment) {
      throw new FinanceException('PAYMENT_NOT_FOUND');
    }

    this.paymentState.assertTransition(payment.status, PaymentStatus.SUBMITTED);

    const amount = input.amount != null ? round2(input.amount) : payment.amount;

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const txn = payment.transactions[0];
        if (txn) {
          await tx.paymentTransaction.update({
            where: { id: txn.id },
            data: {
              utr,
              amount,
              status: FinanceTransactionStatus.PROCESSING,
              metadata: {
                paymentDate: input.paymentDate ?? null,
                note: input.note ?? null,
              } as Prisma.InputJsonValue,
            },
          });
        } else {
          await tx.paymentTransaction.create({
            data: {
              transactionReference: this.nextTxnRef(),
              paymentId: payment.id,
              purchaseOrderId: payment.purchaseOrderId,
              proformaInvoiceId: payment.proformaInvoiceId,
              amount,
              currency: payment.currency,
              rail: payment.rail,
              utr,
              transactionType: FinanceTransactionType.PAYMENT,
              status: FinanceTransactionStatus.PROCESSING,
              metadata: {
                paymentDate: input.paymentDate ?? null,
                note: input.note ?? null,
              } as Prisma.InputJsonValue,
            },
          });
        }

        const submitted = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.SUBMITTED,
            utr,
            submittedAt: new Date(),
            pendingAmount: amount,
            metadata: {
              ...((payment.metadata as Record<string, unknown>) ?? {}),
              note: input.note ?? null,
              paymentDate: input.paymentDate ?? null,
            } as Prisma.InputJsonValue,
            statusHistory: {
              create: {
                fromStatus: payment.status,
                toStatus: PaymentStatus.SUBMITTED,
                notes: input.note ?? 'UTR submitted',
              },
            },
          },
        });

        await this.events.record(tx, {
          purchaseOrderId: payment.purchaseOrderId,
          paymentId: payment.id,
          eventType: 'PAYMENT_SUBMITTED',
          actorRole: 'CUSTOMER',
          actorUserId,
          metadata: { utr },
        });

        this.paymentState.assertTransition(
          PaymentStatus.SUBMITTED,
          PaymentStatus.UNDER_VERIFICATION,
        );

        const under = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.UNDER_VERIFICATION,
            statusHistory: {
              create: {
                fromStatus: PaymentStatus.SUBMITTED,
                toStatus: PaymentStatus.UNDER_VERIFICATION,
                notes: 'Awaiting admin verification',
              },
            },
          },
          include: { transactions: true },
        });

        await this.events.record(tx, {
          purchaseOrderId: payment.purchaseOrderId,
          paymentId: payment.id,
          eventType: 'PAYMENT_UNDER_VERIFICATION',
          actorRole: 'CUSTOMER',
          actorUserId,
          metadata: { utr },
        });

        void submitted;
        return under;
      });

      return this.toCustomerView(updated);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new FinanceException(
          'UTR_ALREADY_USED',
          'This UTR has already been used',
        );
      }
      throw err;
    }
  }

  async getStatus(paymentId: string, customerOrgId: string) {
    const payment = await this.requireOwned(paymentId, customerOrgId);
    return {
      id: payment.id,
      referenceNumber: payment.referenceNumber,
      status: payment.status,
      amount: toDecimal(payment.amount).toFixed(2),
      utr: payment.utr,
      submittedAt: payment.submittedAt,
      verifiedAt: payment.verifiedAt,
    };
  }

  async findOneForCustomer(paymentId: string, customerOrgId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, organizationId: customerOrgId },
      include: { transactions: true, statusHistory: true },
    });
    if (!payment) throw new FinanceException('PAYMENT_NOT_FOUND');
    return this.toCustomerView(payment);
  }

  async listForCustomer(customerOrgId: string, skip: number, take: number) {
    const where = { organizationId: customerOrgId };
    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { transactions: { take: 1, orderBy: { createdAt: 'desc' } } },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { items: items.map((p) => this.toCustomerView(p)), total };
  }

  async listForSeller(sellerOrgId: string, skip: number, take: number) {
    const where = { sellerOrgId };
    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return {
      items: items.map((p) => this.toSellerView(p)),
      total,
    };
  }

  async listForAdmin(skip: number, take: number, status?: PaymentStatus) {
    const where: Prisma.PaymentWhereInput = status ? { status } : {};
    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          organization: { select: { id: true, name: true, legalName: true } },
          sellerOrg: { select: { id: true, name: true, legalName: true } },
          transactions: { take: 1, orderBy: { createdAt: 'desc' } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return {
      items: items.map((p) => this.toAdminView(p)),
      total,
    };
  }

  async findOneForAdmin(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        organization: { select: { id: true, name: true, legalName: true } },
        sellerOrg: { select: { id: true, name: true, legalName: true } },
        transactions: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!payment) throw new FinanceException('PAYMENT_NOT_FOUND');
    return this.toAdminView(payment);
  }

  private async requireOwned(paymentId: string, customerOrgId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, organizationId: customerOrgId },
    });
    if (!payment) throw new FinanceException('PAYMENT_NOT_FOUND');
    return payment;
  }

  toCustomerView(
    payment: Prisma.PaymentGetPayload<{
      include?: { transactions?: true; statusHistory?: true };
    }>,
  ) {
    return {
      id: payment.id,
      referenceNumber: payment.referenceNumber,
      purchaseOrderId: payment.purchaseOrderId,
      proformaInvoiceId: payment.proformaInvoiceId,
      paymentScheduleId: payment.paymentScheduleId,
      method: payment.method,
      rail: payment.rail,
      status: payment.status,
      currency: payment.currency,
      amount: toDecimal(payment.amount).toFixed(2),
      pendingAmount: toDecimal(payment.pendingAmount).toFixed(2),
      utr: payment.utr,
      submittedAt: payment.submittedAt,
      verifiedAt: payment.verifiedAt,
      createdAt: payment.createdAt,
      // Never expose admin notes / failure internals beyond failureReason for customer reject path
      failureReason:
        payment.status === PaymentStatus.REJECTED
          ? payment.failureReason
          : undefined,
    };
  }

  toSellerView(payment: {
    id: string;
    referenceNumber: string;
    purchaseOrderId: string | null;
    method: string;
    rail: string | null;
    status: PaymentStatus;
    currency: string;
    amount: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    createdAt: Date;
    verifiedAt: Date | null;
  }) {
    return {
      id: payment.id,
      referenceNumber: payment.referenceNumber,
      purchaseOrderId: payment.purchaseOrderId,
      method: payment.method,
      rail: payment.rail,
      status: payment.status,
      currency: payment.currency,
      amount: toDecimal(payment.amount).toFixed(2),
      paidAmount: toDecimal(payment.paidAmount).toFixed(2),
      verifiedAt: payment.verifiedAt,
      createdAt: payment.createdAt,
    };
  }

  toAdminView(payment: {
    id: string;
    referenceNumber: string;
    purchaseOrderId: string | null;
    proformaInvoiceId: string | null;
    paymentScheduleId: string | null;
    method: string;
    rail: string | null;
    status: PaymentStatus;
    currency: string;
    amount: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    pendingAmount: Prisma.Decimal;
    utr: string | null;
    submittedAt: Date | null;
    verifiedAt: Date | null;
    verifiedById: string | null;
    failureReason: string | null;
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
    organization?: {
      id: string;
      name: string;
      legalName: string | null;
    } | null;
    sellerOrg?: {
      id: string;
      name: string;
      legalName: string | null;
    } | null;
    transactions?: unknown;
    statusHistory?: unknown;
  }) {
    return {
      id: payment.id,
      referenceNumber: payment.referenceNumber,
      purchaseOrderId: payment.purchaseOrderId,
      proformaInvoiceId: payment.proformaInvoiceId,
      paymentScheduleId: payment.paymentScheduleId,
      method: payment.method,
      rail: payment.rail,
      status: payment.status,
      currency: payment.currency,
      amount: toDecimal(payment.amount).toFixed(2),
      paidAmount: toDecimal(payment.paidAmount).toFixed(2),
      pendingAmount: toDecimal(payment.pendingAmount).toFixed(2),
      utr: payment.utr,
      submittedAt: payment.submittedAt,
      verifiedAt: payment.verifiedAt,
      verifiedById: payment.verifiedById,
      failureReason: payment.failureReason,
      metadata: payment.metadata,
      customerOrg: payment.organization
        ? {
            id: payment.organization.id,
            legalName:
              payment.organization.legalName ?? payment.organization.name,
          }
        : null,
      sellerOrg: payment.sellerOrg
        ? {
            id: payment.sellerOrg.id,
            legalName: payment.sellerOrg.legalName ?? payment.sellerOrg.name,
          }
        : null,
      transactions: payment.transactions,
      statusHistory: payment.statusHistory,
      createdAt: payment.createdAt,
    };
  }
}
