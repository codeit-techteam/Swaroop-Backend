import { Injectable } from '@nestjs/common';
import {
  CreditAccountStatus,
  CreditStatus,
  CreditTransactionStatus,
  CreditTransactionType,
  PaymentScheduleStatus,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { FinanceException } from '../common/finance.errors.js';
import { PLATFORM_CREDIT_METHODS } from '../common/platform-credit.js';
import { add, cmp, round2, sub, toDecimal } from '../common/money.util.js';
import { generateUniqueCreditRef } from '../common/credit-number.js';

type TxClient = Prisma.TransactionClient | PrismaService;

export function utilizationPercentage(
  utilized: Prisma.Decimal | number | string | null | undefined,
  approved: Prisma.Decimal | number | string | null | undefined,
): string {
  const limit = toDecimal(approved);
  if (cmp(limit, 0) <= 0) return '0.00';
  return round2(toDecimal(utilized).times(100).dividedBy(limit)).toFixed(2);
}

@Injectable()
export class CreditLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async lockProfile(tx: TxClient, creditProfileId: string) {
    await tx.$queryRaw`
      SELECT id FROM customer_credit_profiles
      WHERE id = ${creditProfileId}::uuid
      FOR UPDATE
    `;
  }

  async refreshBalances(tx: TxClient, creditProfileId: string) {
    const profile = await tx.customerCreditProfile.findUnique({
      where: { id: creditProfileId },
      include: {
        customerProfile: { select: { organizationId: true } },
      },
    });
    if (!profile) {
      throw new FinanceException(
        'CREDIT_NOT_AVAILABLE',
        'Credit account not found',
      );
    }

    const pos = await tx.purchaseOrder.findMany({
      where: {
        customerOrgId: profile.customerProfile.organizationId,
        deletedAt: null,
        paymentMethod: { in: PLATFORM_CREDIT_METHODS },
      },
      select: { id: true },
    });
    const poIds = pos.map((row) => row.id);

    const ledger =
      poIds.length === 0
        ? []
        : await tx.creditTransaction.findMany({
            where: {
              creditProfileId,
              purchaseOrderId: { in: poIds },
              status: CreditTransactionStatus.POSTED,
              type: {
                in: [
                  CreditTransactionType.CREDIT_RESERVED,
                  CreditTransactionType.CREDIT_UTILIZED,
                  CreditTransactionType.CREDIT_RELEASED,
                  CreditTransactionType.CREDIT_SETTLED,
                  CreditTransactionType.CREDIT_REPAID,
                ],
              },
            },
            select: {
              purchaseOrderId: true,
              type: true,
              amount: true,
            },
          });

    const reserved = new Set<string>();
    const utilized = new Set<string>();
    const released = new Set<string>();
    const reservedAmount = new Map<string, Prisma.Decimal>();
    for (const row of ledger) {
      if (!row.purchaseOrderId) continue;
      if (row.type === CreditTransactionType.CREDIT_RESERVED) {
        reserved.add(row.purchaseOrderId);
        reservedAmount.set(row.purchaseOrderId, toDecimal(row.amount));
      }
      if (row.type === CreditTransactionType.CREDIT_UTILIZED) {
        utilized.add(row.purchaseOrderId);
      }
      if (row.type === CreditTransactionType.CREDIT_RELEASED) {
        released.add(row.purchaseOrderId);
      }
    }

    let pending = toDecimal(0);
    for (const poId of reserved) {
      if (utilized.has(poId) || released.has(poId)) continue;
      pending = add(pending, reservedAmount.get(poId) ?? 0);
    }

    const utilizedPoIds = [...utilized].filter((id) => !released.has(id));
    const schedules =
      utilizedPoIds.length === 0
        ? []
        : await tx.paymentSchedule.findMany({
            where: {
              purchaseOrderId: { in: utilizedPoIds },
              status: {
                notIn: [
                  PaymentScheduleStatus.CANCELLED,
                  PaymentScheduleStatus.WAIVED,
                ],
              },
            },
          });

    const now = new Date();
    let outstanding = toDecimal(0);
    let overdue = toDecimal(0);
    for (const schedule of schedules) {
      const remaining = toDecimal(schedule.remainingAmount);
      if (cmp(remaining, 0) <= 0) continue;
      outstanding = add(outstanding, remaining);
      const dueAt = schedule.dueAt;
      const isOverdue =
        schedule.status === PaymentScheduleStatus.OVERDUE ||
        (dueAt != null && dueAt.getTime() < now.getTime());
      if (isOverdue) overdue = add(overdue, remaining);
    }

    const approved = toDecimal(profile.approvedLimit);
    const availableRaw = approved.minus(pending).minus(outstanding);
    const available =
      cmp(availableRaw, 0) < 0 ? toDecimal(0) : round2(availableRaw);

    return tx.customerCreditProfile.update({
      where: { id: creditProfileId },
      data: {
        pendingCredit: round2(pending),
        utilizedAmount: outstanding,
        outstandingAmount: outstanding,
        overdueAmount: overdue,
        availableLimit: available,
      },
    });
  }

  async recordTransaction(
    tx: TxClient,
    input: {
      creditProfileId: string;
      customerProfileId: string;
      type: CreditTransactionType;
      amount: Prisma.Decimal | number | string;
      currency?: 'INR' | 'USD' | 'EUR' | 'AED';
      referenceType?: string;
      referenceId?: string;
      purchaseOrderId?: string;
      paymentId?: string;
      createdById?: string;
      source?: string;
      notes?: string;
      metadata?: Record<string, unknown>;
      balanceBefore?: Prisma.Decimal | number | string;
      balanceAfter?: Prisma.Decimal | number | string;
    },
  ) {
    const transactionNumber = await generateUniqueCreditRef(
      async (candidate) =>
        Boolean(
          await tx.creditTransaction.findUnique({
            where: { transactionNumber: candidate },
            select: { id: true },
          }),
        ),
      'CTX',
    );
    return tx.creditTransaction.create({
      data: {
        transactionNumber,
        creditProfileId: input.creditProfileId,
        customerProfileId: input.customerProfileId,
        type: input.type,
        status: CreditTransactionStatus.POSTED,
        amount: toDecimal(input.amount),
        balanceBefore:
          input.balanceBefore == null
            ? undefined
            : toDecimal(input.balanceBefore),
        balanceAfter:
          input.balanceAfter == null
            ? undefined
            : toDecimal(input.balanceAfter),
        currency: input.currency ?? 'INR',
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        purchaseOrderId: input.purchaseOrderId,
        paymentId: input.paymentId,
        createdById: input.createdById,
        source: input.source ?? 'SYSTEM',
        notes: input.notes,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private async loadEligibleAccount(tx: TxClient, customerOrgId: string) {
    const customer = await tx.customerProfile.findFirst({
      where: { organizationId: customerOrgId, deletedAt: null },
      include: { creditProfile: true },
    });
    const credit = customer?.creditProfile;
    if (!credit || credit.status !== CreditStatus.APPROVED) {
      throw new FinanceException(
        'CREDIT_NOT_AVAILABLE',
        'Approved PetroTrade credit account is required',
      );
    }
    if (credit.accountStatus !== CreditAccountStatus.ACTIVE) {
      throw new FinanceException(
        'CREDIT_NOT_AVAILABLE',
        `Credit account is ${credit.accountStatus}`,
      );
    }
    if (credit.expiresAt && credit.expiresAt.getTime() < Date.now()) {
      throw new FinanceException(
        'CREDIT_NOT_AVAILABLE',
        'Credit account has expired',
      );
    }
    return { customer, credit };
  }

  async reserveForPurchaseOrder(
    tx: TxClient,
    input: {
      customerOrgId: string;
      purchaseOrderId: string;
      amount: Prisma.Decimal | number | string;
      actorUserId?: string;
    },
  ) {
    const existing = await tx.creditTransaction.findFirst({
      where: {
        purchaseOrderId: input.purchaseOrderId,
        type: {
          in: [
            CreditTransactionType.CREDIT_RESERVED,
            CreditTransactionType.CREDIT_UTILIZED,
          ],
        },
        status: CreditTransactionStatus.POSTED,
      },
      select: { id: true, type: true },
    });
    if (existing) return existing;

    const { customer, credit } = await this.loadEligibleAccount(
      tx,
      input.customerOrgId,
    );
    await this.lockProfile(tx, credit.id);
    const locked = await tx.customerCreditProfile.findUniqueOrThrow({
      where: { id: credit.id },
    });

    const amount = round2(input.amount);
    const available = toDecimal(locked.availableLimit);
    if (cmp(available, amount) < 0) {
      throw new FinanceException(
        'CREDIT_LIMIT_EXCEEDED',
        `Available credit ${available.toFixed(2)} is less than PO total ${amount.toFixed(2)}`,
      );
    }

    const nextAvailable = sub(available, amount);
    try {
      await this.recordTransaction(tx, {
        creditProfileId: credit.id,
        customerProfileId: customer.id,
        type: CreditTransactionType.CREDIT_RESERVED,
        amount,
        currency: credit.currency,
        referenceType: 'PURCHASE_ORDER',
        referenceId: input.purchaseOrderId,
        purchaseOrderId: input.purchaseOrderId,
        createdById: input.actorUserId,
        source: 'SYSTEM',
        notes: 'Platform credit reserved against purchase order',
        balanceBefore: available,
        balanceAfter: nextAvailable,
        metadata: { lifecycle: 'RESERVED' },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return tx.creditTransaction.findFirstOrThrow({
          where: {
            purchaseOrderId: input.purchaseOrderId,
            type: CreditTransactionType.CREDIT_RESERVED,
          },
          select: { id: true, type: true },
        });
      }
      throw err;
    }

    return this.refreshBalances(tx, credit.id);
  }

  async utilizeForPurchaseOrder(
    tx: TxClient,
    input: {
      customerOrgId: string;
      purchaseOrderId: string;
      amount: Prisma.Decimal | number | string;
      actorUserId?: string;
    },
  ) {
    return this.reserveForPurchaseOrder(tx, input);
  }

  async utilizeReservedCredit(
    tx: TxClient,
    input: {
      customerOrgId: string;
      purchaseOrderId: string;
      amount?: Prisma.Decimal | number | string;
      actorUserId?: string;
    },
  ) {
    const already = await tx.creditTransaction.findFirst({
      where: {
        purchaseOrderId: input.purchaseOrderId,
        type: CreditTransactionType.CREDIT_UTILIZED,
        status: CreditTransactionStatus.POSTED,
      },
      select: { id: true },
    });
    if (already) return already;

    const reservation = await tx.creditTransaction.findFirst({
      where: {
        purchaseOrderId: input.purchaseOrderId,
        type: CreditTransactionType.CREDIT_RESERVED,
        status: CreditTransactionStatus.POSTED,
      },
    });
    if (!reservation) {
      await this.reserveForPurchaseOrder(tx, {
        ...input,
        amount: input.amount ?? 0,
      });
    }

    const { customer, credit } = await this.loadEligibleAccount(
      tx,
      input.customerOrgId,
    );
    await this.lockProfile(tx, credit.id);
    const amount = round2(input.amount ?? reservation?.amount ?? 0);
    const before = toDecimal(credit.availableLimit);

    await this.recordTransaction(tx, {
      creditProfileId: credit.id,
      customerProfileId: customer.id,
      type: CreditTransactionType.CREDIT_UTILIZED,
      amount,
      currency: credit.currency,
      referenceType: 'PURCHASE_ORDER',
      referenceId: input.purchaseOrderId,
      purchaseOrderId: input.purchaseOrderId,
      createdById: input.actorUserId,
      source: 'SYSTEM',
      notes: 'Reserved platform credit utilized at dispatch',
      balanceBefore: before,
      balanceAfter: before,
      metadata: { lifecycle: 'UTILIZED' },
    });

    return this.refreshBalances(tx, credit.id);
  }

  async releaseForPurchaseOrder(
    tx: TxClient,
    input: {
      customerOrgId: string;
      purchaseOrderId: string;
      actorUserId?: string;
    },
  ) {
    const released = await tx.creditTransaction.findFirst({
      where: {
        purchaseOrderId: input.purchaseOrderId,
        type: CreditTransactionType.CREDIT_RELEASED,
        status: CreditTransactionStatus.POSTED,
      },
      select: { id: true },
    });
    if (released) return released;

    const reservation = await tx.creditTransaction.findFirst({
      where: {
        purchaseOrderId: input.purchaseOrderId,
        type: CreditTransactionType.CREDIT_RESERVED,
        status: CreditTransactionStatus.POSTED,
      },
    });
    if (!reservation) return null;

    const customer = await tx.customerProfile.findFirst({
      where: { organizationId: input.customerOrgId, deletedAt: null },
      include: { creditProfile: true },
    });
    const credit = customer?.creditProfile;
    if (!credit) return null;

    await this.lockProfile(tx, credit.id);
    const before = toDecimal(credit.availableLimit);
    const after = add(before, reservation.amount);

    await this.recordTransaction(tx, {
      creditProfileId: credit.id,
      customerProfileId: customer.id,
      type: CreditTransactionType.CREDIT_RELEASED,
      amount: reservation.amount,
      currency: credit.currency,
      referenceType: 'PURCHASE_ORDER',
      referenceId: input.purchaseOrderId,
      purchaseOrderId: input.purchaseOrderId,
      createdById: input.actorUserId,
      source: 'SYSTEM',
      notes: 'Platform credit reservation released',
      balanceBefore: before,
      balanceAfter: after,
      metadata: { lifecycle: 'RELEASED' },
    });

    return this.refreshBalances(tx, credit.id);
  }

  async repayForPayment(
    tx: TxClient,
    input: {
      customerOrgId: string;
      purchaseOrderId?: string | null;
      paymentId: string;
      amount: Prisma.Decimal | number | string;
      actorUserId?: string;
    },
  ) {
    const existing = await tx.creditTransaction.findFirst({
      where: {
        paymentId: input.paymentId,
        type: {
          in: [
            CreditTransactionType.CREDIT_REPAID,
            CreditTransactionType.CREDIT_SETTLED,
          ],
        },
        status: CreditTransactionStatus.POSTED,
      },
      select: { id: true },
    });
    if (existing) return existing;

    const customer = await tx.customerProfile.findFirst({
      where: { organizationId: input.customerOrgId, deletedAt: null },
      include: { creditProfile: true },
    });
    const credit = customer?.creditProfile;
    if (!credit) return null;

    await this.lockProfile(tx, credit.id);
    const before = toDecimal(credit.availableLimit);
    const amount = round2(input.amount);
    const after = add(before, amount);

    await this.recordTransaction(tx, {
      creditProfileId: credit.id,
      customerProfileId: customer.id,
      type: CreditTransactionType.CREDIT_SETTLED,
      amount,
      currency: credit.currency,
      referenceType: 'PAYMENT',
      referenceId: input.paymentId,
      purchaseOrderId: input.purchaseOrderId ?? undefined,
      paymentId: input.paymentId,
      createdById: input.actorUserId,
      source: 'ADMIN',
      notes: 'Credit settlement recorded from verified payment',
      balanceBefore: before,
      balanceAfter: after,
      metadata: { lifecycle: 'SETTLED' },
    });

    return this.refreshBalances(tx, credit.id);
  }
}
