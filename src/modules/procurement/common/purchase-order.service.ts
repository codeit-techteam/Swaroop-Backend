import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  PaymentMethod,
  Prisma,
  ProcurementStatus,
  PurchaseOrderStatus,
  type PurchaseRequest,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { ProcurementException } from './procurement.errors.js';

type TxClient = Prisma.TransactionClient;

export type CommercialSnapshot = {
  gradeId: string | null;
  productId: string | null;
  offerId: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalValue: number;
  paymentMethod: PaymentMethod | null;
  currency: CurrencyCode;
  negotiationRound: number | null;
  acceptedByRole: string;
  acceptedAt: string;
};

@Injectable()
export class PurchaseOrderService {
  constructor(private readonly prisma: PrismaService) {}

  nextPoReference(now = new Date()): string {
    const year = now.getFullYear();
    const seq = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0');
    return `PO-${year}-${seq}`;
  }

  nextProcReference(now = new Date()): string {
    const year = now.getFullYear();
    const seq = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0');
    return `PROC-${year}-${seq}`;
  }

  async createFromAcceptedPr(
    tx: TxClient,
    pr: PurchaseRequest & {
      items?: Array<{
        gradeId: string;
        productId: string | null;
        offerId: string | null;
        quantity: Prisma.Decimal | number;
        unit: string;
      }>;
    },
    snapshot: CommercialSnapshot,
  ) {
    const existing = await tx.purchaseOrder.findFirst({
      where: { purchaseRequestId: pr.id, deletedAt: null },
    });
    if (existing) {
      return existing;
    }

    if (!pr.sellerOrgId) {
      throw new ProcurementException(
        'INVALID_STATUS_TRANSITION',
        'Purchase request has no seller organization for PO creation',
      );
    }

    const now = new Date();
    let purchaseOrder: Awaited<
      ReturnType<TxClient['purchaseOrder']['create']>
    > | null = null;

    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        purchaseOrder = await tx.purchaseOrder.create({
          data: {
            referenceNumber: this.nextPoReference(now),
            purchaseRequestId: pr.id,
            customerOrgId: pr.customerOrgId,
            sellerOrgId: pr.sellerOrgId,
            status: PurchaseOrderStatus.CONFIRMED,
            currency: snapshot.currency,
            subtotal: snapshot.totalValue,
            taxAmount: 0,
            totalAmount: snapshot.totalValue,
            paymentMethod: snapshot.paymentMethod,
            orderedQuantity: snapshot.quantity,
            dispatchedQuantity: 0,
            deliveredQuantity: 0,
            confirmedAt: now,
            metadata: {
              commercialSnapshot: snapshot,
              source: 'phase7_commercial_acceptance',
            } as Prisma.InputJsonValue,
          },
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
          if (fields.some((f) => String(f).includes('purchase_request'))) {
            const raced = await tx.purchaseOrder.findFirst({
              where: { purchaseRequestId: pr.id, deletedAt: null },
            });
            if (raced) return raced;
            throw new ProcurementException(
              'PO_ALREADY_CREATED',
              'Purchase order already exists for this purchase request',
            );
          }
          if (fields.some((f) => String(f).includes('reference'))) {
            continue;
          }
        }
        throw err;
      }
    }

    if (!purchaseOrder) {
      throw new ProcurementException(
        'INVALID_STATUS_TRANSITION',
        'Unable to allocate purchase order reference',
      );
    }

    let procCase = await tx.procurementCase.findUnique({
      where: { purchaseRequestId: pr.id },
    });

    if (!procCase) {
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          procCase = await tx.procurementCase.create({
            data: {
              referenceNumber: this.nextProcReference(now),
              purchaseRequestId: pr.id,
              organizationId: pr.customerOrgId,
              status: ProcurementStatus.CONVERTED_TO_PO,
              notes: `Auto-created from ${pr.referenceNumber}`,
              metadata: {
                purchaseOrderId: purchaseOrder.id,
                poReference: purchaseOrder.referenceNumber,
              } as Prisma.InputJsonValue,
            },
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
            if (fields.some((f) => String(f).includes('purchase_request'))) {
              procCase = await tx.procurementCase.findUnique({
                where: { purchaseRequestId: pr.id },
              });
              break;
            }
            if (fields.some((f) => String(f).includes('reference'))) {
              continue;
            }
          }
          throw err;
        }
      }
    } else if (procCase.status !== ProcurementStatus.CONVERTED_TO_PO) {
      procCase = await tx.procurementCase.update({
        where: { id: procCase.id },
        data: {
          status: ProcurementStatus.CONVERTED_TO_PO,
          metadata: {
            ...((procCase.metadata as object) ?? {}),
            purchaseOrderId: purchaseOrder.id,
            poReference: purchaseOrder.referenceNumber,
          } as Prisma.InputJsonValue,
        },
      });
    }

    if (procCase && !purchaseOrder.procurementCaseId) {
      purchaseOrder = await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: { procurementCaseId: procCase.id },
      });
    }

    return purchaseOrder;
  }
}
