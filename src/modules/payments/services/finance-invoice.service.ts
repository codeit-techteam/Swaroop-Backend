import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  FinanceInvoiceStatus,
  Prisma,
  type FinanceInvoice,
  type PurchaseOrder,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { REFERENCE_NUMBER_PREFIX } from '../../../common/enums/domain.enums.js';
import { toDecimal } from '../common/money.util.js';

type TxClient = Prisma.TransactionClient;

@Injectable()
export class FinanceInvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  nextInvoiceNumber(now = new Date()): string {
    const year = now.getFullYear();
    const seq = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0');
    return `${REFERENCE_NUMBER_PREFIX.INVOICE}-${year}-${seq}`;
  }

  /**
   * Foundation only — creates DRAFT tax invoice. Does NOT auto-issue.
   * Idempotent per purchaseOrderId (returns existing if present).
   */
  async createDraft(
    tx: TxClient,
    purchaseOrder: PurchaseOrder,
    proformaInvoiceId?: string | null,
  ): Promise<FinanceInvoice> {
    const existing = await tx.financeInvoice.findFirst({
      where: { purchaseOrderId: purchaseOrder.id, deletedAt: null },
    });
    if (existing) return existing;

    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        return await tx.financeInvoice.create({
          data: {
            invoiceNumber: this.nextInvoiceNumber(),
            purchaseOrderId: purchaseOrder.id,
            proformaInvoiceId: proformaInvoiceId ?? undefined,
            customerOrgId: purchaseOrder.customerOrgId,
            sellerOrgId: purchaseOrder.sellerOrgId,
            status: FinanceInvoiceStatus.DRAFT,
            currency: purchaseOrder.currency ?? CurrencyCode.INR,
            subtotal: purchaseOrder.subtotal,
            taxAmount: purchaseOrder.taxAmount,
            totalAmount: purchaseOrder.totalAmount,
            metadata: {
              source: 'phase8_payment_verified',
            } as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const raced = await tx.financeInvoice.findFirst({
            where: { purchaseOrderId: purchaseOrder.id, deletedAt: null },
          });
          if (raced) return raced;
          continue;
        }
        throw err;
      }
    }

    const fallback = await tx.financeInvoice.findFirst({
      where: { purchaseOrderId: purchaseOrder.id, deletedAt: null },
    });
    if (fallback) return fallback;
    throw new Error('Failed to create finance invoice draft');
  }

  async list(params: {
    customerOrgId?: string;
    sellerOrgId?: string;
    skip: number;
    take: number;
  }) {
    const where: Prisma.FinanceInvoiceWhereInput = {
      deletedAt: null,
      ...(params.customerOrgId ? { customerOrgId: params.customerOrgId } : {}),
      ...(params.sellerOrgId ? { sellerOrgId: params.sellerOrgId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.financeInvoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.financeInvoice.count({ where }),
    ]);
    return {
      items: items.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        purchaseOrderId: inv.purchaseOrderId,
        status: inv.status,
        currency: inv.currency,
        totalAmount: toDecimal(inv.totalAmount).toFixed(2),
        createdAt: inv.createdAt,
      })),
      total,
    };
  }
}
