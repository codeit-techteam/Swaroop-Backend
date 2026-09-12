import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SettlementStatus,
  type PurchaseOrder,
  type Settlement,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { REFERENCE_NUMBER_PREFIX } from '../../../common/enums/domain.enums.js';
import { toDecimal } from '../common/money.util.js';
import { SettlementCalculationService } from './settlement-calculation.service.js';

type TxClient = Prisma.TransactionClient;

@Injectable()
export class SettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calc: SettlementCalculationService,
  ) {}

  nextReference(now = new Date()): string {
    const year = now.getFullYear();
    const seq = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0');
    return `${REFERENCE_NUMBER_PREFIX.SETTLEMENT}-${year}-${seq}`;
  }

  /**
   * Creates PENDING settlement draft for a fully paid PO. Idempotent.
   * Deductions default to 0 unless explicitly provided.
   */
  async createPendingDraft(
    tx: TxClient,
    purchaseOrder: PurchaseOrder,
    opts?: { paymentId?: string; deductions?: number },
  ): Promise<Settlement> {
    const existing = await tx.settlement.findFirst({
      where: {
        purchaseOrderId: purchaseOrder.id,
        status: {
          in: [
            SettlementStatus.PENDING,
            SettlementStatus.PROCESSING,
            SettlementStatus.READY,
            SettlementStatus.RELEASED,
            SettlementStatus.ON_HOLD,
          ],
        },
      },
    });
    if (existing) return existing;

    const amounts = this.calc.calculate({
      grossAmount: purchaseOrder.subtotal,
      taxAmount: purchaseOrder.taxAmount,
      deductions: opts?.deductions ?? 0,
    });

    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const settlement = await tx.settlement.create({
          data: {
            referenceNumber: this.nextReference(),
            organizationId: purchaseOrder.sellerOrgId,
            purchaseOrderId: purchaseOrder.id,
            status: SettlementStatus.PENDING,
            currency: purchaseOrder.currency,
            grossAmount: amounts.grossAmount,
            taxAmount: amounts.taxAmount,
            platformFee: amounts.platformFee,
            tdsAmount: amounts.tdsAmount,
            deductions: amounts.deductions,
            netAmount: amounts.netAmount,
            metadata: {
              source: 'phase8_payment_cleared',
            } as Prisma.InputJsonValue,
            statusHistory: {
              create: {
                toStatus: SettlementStatus.PENDING,
                notes: 'Draft settlement created after payment cleared',
              },
            },
            ...(opts?.paymentId
              ? {
                  items: {
                    create: {
                      paymentId: opts.paymentId,
                      description: 'Verified payment allocation',
                      amount: amounts.netAmount,
                    },
                  },
                }
              : {}),
          },
        });
        return settlement;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const raced = await tx.settlement.findFirst({
            where: { purchaseOrderId: purchaseOrder.id },
          });
          if (raced) return raced;
          continue;
        }
        throw err;
      }
    }

    throw new Error('Failed to create settlement draft');
  }

  async list(params: { organizationId?: string; skip: number; take: number }) {
    const where: Prisma.SettlementWhereInput = {
      ...(params.organizationId
        ? { organizationId: params.organizationId }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.settlement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.settlement.count({ where }),
    ]);
    return {
      items: items.map((s) => ({
        id: s.id,
        referenceNumber: s.referenceNumber,
        purchaseOrderId: s.purchaseOrderId,
        status: s.status,
        currency: s.currency,
        grossAmount: toDecimal(s.grossAmount).toFixed(2),
        netAmount: toDecimal(s.netAmount).toFixed(2),
        createdAt: s.createdAt,
      })),
      total,
    };
  }
}
