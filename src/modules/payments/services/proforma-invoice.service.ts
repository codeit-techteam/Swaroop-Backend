import { Injectable } from '@nestjs/common';
import {
  Prisma,
  ProformaInvoiceStatus,
  type ProformaInvoice,
  type PurchaseOrder,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { CommercialSnapshot } from '../../procurement/common/purchase-order.service.js';
import { FinanceException } from '../common/finance.errors.js';
import {
  add,
  cmp,
  isZero,
  round2,
  sub,
  toDecimal,
} from '../common/money.util.js';

type TxClient = Prisma.TransactionClient;

@Injectable()
export class ProformaInvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  nextPiNumber(now = new Date()): string {
    const year = now.getFullYear();
    const seq = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0');
    return `PI-${year}-${seq}`;
  }

  async findByPurchaseOrderId(
    purchaseOrderId: string,
  ): Promise<ProformaInvoice | null> {
    return this.prisma.proformaInvoice.findUnique({
      where: { purchaseOrderId },
      include: {
        lines: { orderBy: { sequence: 'asc' } },
        paymentSchedules: { orderBy: { sequence: 'asc' } },
        customerOrg: {
          select: { id: true, name: true, legalName: true },
        },
        sellerOrg: {
          select: { id: true, name: true, legalName: true },
        },
      },
    }) as Promise<ProformaInvoice | null>;
  }

  async createIssued(
    tx: TxClient,
    purchaseOrder: PurchaseOrder,
    snapshot: CommercialSnapshot,
    billingSnapshot?: Prisma.InputJsonValue,
    shippingSnapshot?: Prisma.InputJsonValue,
  ): Promise<ProformaInvoice> {
    const existing = await tx.proformaInvoice.findUnique({
      where: { purchaseOrderId: purchaseOrder.id },
    });
    if (existing) {
      return existing;
    }

    const total = round2(snapshot.totalValue);
    const now = new Date();
    let pi: ProformaInvoice | null = null;

    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        pi = await tx.proformaInvoice.create({
          data: {
            piNumber: this.nextPiNumber(now),
            purchaseOrderId: purchaseOrder.id,
            customerOrgId: purchaseOrder.customerOrgId,
            sellerOrgId: purchaseOrder.sellerOrgId,
            status: ProformaInvoiceStatus.ISSUED,
            issueDate: now,
            currency: snapshot.currency ?? purchaseOrder.currency,
            subtotal: total,
            discountAmount: 0,
            taxAmount: 0,
            totalAmount: total,
            paidAmount: 0,
            remainingAmount: total,
            commercialSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            billingSnapshot: billingSnapshot ?? undefined,
            shippingSnapshot: shippingSnapshot ?? undefined,
            lines: {
              create: [
                {
                  sequence: 1,
                  description: `Commercial line — ${snapshot.unit} @ ${snapshot.unitPrice}`,
                  gradeId: snapshot.gradeId,
                  productId: snapshot.productId,
                  quantity: snapshot.quantity,
                  unit: snapshot.unit,
                  unitPrice: snapshot.unitPrice,
                  lineSubtotal: total,
                  taxAmount: 0,
                  lineTotal: total,
                  currency: snapshot.currency ?? purchaseOrder.currency,
                },
              ],
            },
          },
        });
        break;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const raced = await tx.proformaInvoice.findUnique({
            where: { purchaseOrderId: purchaseOrder.id },
          });
          if (raced) return raced;
          continue;
        }
        throw err;
      }
    }

    if (!pi) {
      throw new FinanceException(
        'PROFORMA_NOT_FOUND',
        'Failed to create proforma invoice',
      );
    }
    return pi;
  }

  async applyVerifiedPayment(
    tx: TxClient,
    proformaInvoiceId: string,
    amount: Prisma.Decimal | number | string,
  ): Promise<ProformaInvoice> {
    const pi = await tx.proformaInvoice.findUnique({
      where: { id: proformaInvoiceId },
    });
    if (!pi) {
      throw new FinanceException('PROFORMA_NOT_FOUND');
    }
    if (pi.status === ProformaInvoiceStatus.CANCELLED) {
      throw new FinanceException('PROFORMA_CANCELLED');
    }

    const payAmount = round2(amount);
    if (cmp(payAmount, pi.remainingAmount) > 0) {
      throw new FinanceException('PAYMENT_OVERPAYMENT');
    }

    const paidAmount = add(pi.paidAmount, payAmount);
    const remainingAmount = sub(pi.remainingAmount, payAmount);
    const status = isZero(remainingAmount)
      ? ProformaInvoiceStatus.PAID
      : ProformaInvoiceStatus.PARTIALLY_PAID;

    return tx.proformaInvoice.update({
      where: { id: proformaInvoiceId },
      data: { paidAmount, remainingAmount, status },
    });
  }

  toCustomerView(
    pi: ProformaInvoice & {
      customerOrg?: { id: string; name: string; legalName: string | null };
      sellerOrg?: { id: string; name: string; legalName: string | null };
      lines?: unknown[];
      paymentSchedules?: unknown[];
    },
  ) {
    return {
      id: pi.id,
      piNumber: pi.piNumber,
      purchaseOrderId: pi.purchaseOrderId,
      status: pi.status,
      issueDate: pi.issueDate,
      dueDate: pi.dueDate,
      currency: pi.currency,
      subtotal: toDecimal(pi.subtotal).toFixed(2),
      taxAmount: toDecimal(pi.taxAmount).toFixed(2),
      totalAmount: toDecimal(pi.totalAmount).toFixed(2),
      paidAmount: toDecimal(pi.paidAmount).toFixed(2),
      remainingAmount: toDecimal(pi.remainingAmount).toFixed(2),
      billing: pi.customerOrg
        ? {
            organizationId: pi.customerOrg.id,
            legalName: pi.customerOrg.legalName ?? pi.customerOrg.name,
          }
        : null,
      lines: pi.lines ?? undefined,
      paymentSchedules: pi.paymentSchedules ?? undefined,
    };
  }

  toSellerView(
    pi: ProformaInvoice & {
      customerOrg?: { id: string; name: string; legalName: string | null };
      sellerOrg?: { id: string; name: string; legalName: string | null };
      lines?: unknown[];
      paymentSchedules?: unknown[];
    },
  ) {
    return {
      id: pi.id,
      piNumber: pi.piNumber,
      purchaseOrderId: pi.purchaseOrderId,
      status: pi.status,
      issueDate: pi.issueDate,
      dueDate: pi.dueDate,
      currency: pi.currency,
      subtotal: toDecimal(pi.subtotal).toFixed(2),
      taxAmount: toDecimal(pi.taxAmount).toFixed(2),
      totalAmount: toDecimal(pi.totalAmount).toFixed(2),
      paidAmount: toDecimal(pi.paidAmount).toFixed(2),
      remainingAmount: toDecimal(pi.remainingAmount).toFixed(2),
      company: pi.sellerOrg
        ? {
            organizationId: pi.sellerOrg.id,
            legalName: pi.sellerOrg.legalName ?? pi.sellerOrg.name,
          }
        : null,
      lines: pi.lines ?? undefined,
      paymentSchedules: pi.paymentSchedules ?? undefined,
    };
  }

  toAdminView(
    pi: ProformaInvoice & {
      customerOrg?: { id: string; name: string; legalName: string | null };
      sellerOrg?: { id: string; name: string; legalName: string | null };
      lines?: unknown[];
      paymentSchedules?: unknown[];
    },
  ) {
    return {
      id: pi.id,
      piNumber: pi.piNumber,
      purchaseOrderId: pi.purchaseOrderId,
      status: pi.status,
      issueDate: pi.issueDate,
      dueDate: pi.dueDate,
      currency: pi.currency,
      subtotal: toDecimal(pi.subtotal).toFixed(2),
      taxAmount: toDecimal(pi.taxAmount).toFixed(2),
      totalAmount: toDecimal(pi.totalAmount).toFixed(2),
      paidAmount: toDecimal(pi.paidAmount).toFixed(2),
      remainingAmount: toDecimal(pi.remainingAmount).toFixed(2),
      customerOrg: pi.customerOrg
        ? {
            id: pi.customerOrg.id,
            legalName: pi.customerOrg.legalName ?? pi.customerOrg.name,
          }
        : null,
      sellerOrg: pi.sellerOrg
        ? {
            id: pi.sellerOrg.id,
            legalName: pi.sellerOrg.legalName ?? pi.sellerOrg.name,
          }
        : null,
      lines: pi.lines ?? undefined,
      paymentSchedules: pi.paymentSchedules ?? undefined,
      commercialSnapshot: pi.commercialSnapshot,
    };
  }
}
