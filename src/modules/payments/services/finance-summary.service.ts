import { Injectable } from '@nestjs/common';
import {
  PaymentStatus,
  ProformaInvoiceStatus,
  SettlementStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { toDecimal } from '../common/money.util.js';

@Injectable()
export class FinanceSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async forCustomer(customerOrgId: string) {
    const [piCounts, paymentCounts, dueSchedules, outstanding] =
      await Promise.all([
        this.prisma.proformaInvoice.groupBy({
          by: ['status'],
          where: { customerOrgId, deletedAt: null },
          _count: { _all: true },
        }),
        this.prisma.payment.groupBy({
          by: ['status'],
          where: { organizationId: customerOrgId },
          _count: { _all: true },
        }),
        this.prisma.paymentSchedule.count({
          where: {
            purchaseOrder: { customerOrgId },
            status: { in: ['DUE', 'PARTIALLY_PAID', 'OVERDUE'] },
          },
        }),
        this.prisma.proformaInvoice.aggregate({
          where: {
            customerOrgId,
            deletedAt: null,
            status: {
              in: [
                ProformaInvoiceStatus.ISSUED,
                ProformaInvoiceStatus.PARTIALLY_PAID,
              ],
            },
          },
          _sum: { remainingAmount: true },
        }),
      ]);

    return {
      role: 'CUSTOMER' as const,
      proformaByStatus: Object.fromEntries(
        piCounts.map((r) => [r.status, r._count._all]),
      ),
      paymentsByStatus: Object.fromEntries(
        paymentCounts.map((r) => [r.status, r._count._all]),
      ),
      dueScheduleCount: dueSchedules,
      outstandingAmount: toDecimal(outstanding._sum.remainingAmount).toFixed(2),
    };
  }

  async forSeller(sellerOrgId: string) {
    const [piCounts, paymentCounts, settlementCounts] = await Promise.all([
      this.prisma.proformaInvoice.groupBy({
        by: ['status'],
        where: { sellerOrgId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.payment.groupBy({
        by: ['status'],
        where: { sellerOrgId },
        _count: { _all: true },
      }),
      this.prisma.settlement.groupBy({
        by: ['status'],
        where: { organizationId: sellerOrgId },
        _count: { _all: true },
      }),
    ]);

    const verifiedPaid = await this.prisma.payment.aggregate({
      where: {
        sellerOrgId,
        status: {
          in: [PaymentStatus.VERIFIED, PaymentStatus.PAID],
        },
      },
      _sum: { paidAmount: true },
    });

    return {
      role: 'SELLER' as const,
      proformaByStatus: Object.fromEntries(
        piCounts.map((r) => [r.status, r._count._all]),
      ),
      paymentsByStatus: Object.fromEntries(
        paymentCounts.map((r) => [r.status, r._count._all]),
      ),
      settlementsByStatus: Object.fromEntries(
        settlementCounts.map((r) => [r.status, r._count._all]),
      ),
      verifiedPaidAmount: toDecimal(verifiedPaid._sum.paidAmount).toFixed(2),
    };
  }

  async forAdmin() {
    const [
      piCounts,
      paymentCounts,
      underVerification,
      settlementPending,
      draftInvoices,
    ] = await Promise.all([
      this.prisma.proformaInvoice.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.payment.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.payment.count({
        where: { status: PaymentStatus.UNDER_VERIFICATION },
      }),
      this.prisma.settlement.count({
        where: { status: SettlementStatus.PENDING },
      }),
      this.prisma.financeInvoice.count({
        where: { status: 'DRAFT', deletedAt: null },
      }),
    ]);

    return {
      role: 'ADMIN' as const,
      proformaByStatus: Object.fromEntries(
        piCounts.map((r) => [r.status, r._count._all]),
      ),
      paymentsByStatus: Object.fromEntries(
        paymentCounts.map((r) => [r.status, r._count._all]),
      ),
      paymentsUnderVerification: underVerification,
      settlementsPending: settlementPending,
      draftFinanceInvoices: draftInvoices,
    };
  }
}
