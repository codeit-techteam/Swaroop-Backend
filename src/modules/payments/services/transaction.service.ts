import { Injectable } from '@nestjs/common';
import {
  FinanceTransactionStatus,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { toDecimal } from '../common/money.util.js';

@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: {
    skip: number;
    take: number;
    status?: FinanceTransactionStatus;
    purchaseOrderId?: string;
  }) {
    const where: Prisma.PaymentTransactionWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.purchaseOrderId
        ? { purchaseOrderId: params.purchaseOrderId }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.paymentTransaction.count({ where }),
    ]);
    return {
      items: items.map((t) => ({
        id: t.id,
        transactionReference: t.transactionReference,
        paymentId: t.paymentId,
        purchaseOrderId: t.purchaseOrderId,
        amount: toDecimal(t.amount).toFixed(2),
        currency: t.currency,
        rail: t.rail,
        utr: t.utr,
        status: t.status,
        transactionType: t.transactionType,
        processedAt: t.processedAt,
        createdAt: t.createdAt,
      })),
      total,
    };
  }
}
