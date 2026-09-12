import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  NegotiationActorRole,
  PaymentMethod,
  Prisma,
  PurchaseRequestStatus,
  type PurchaseRequest,
} from '../../../generated/prisma/client.js';
import { FinanceBootstrapService } from '../../payments/services/finance-bootstrap.service.js';
import { ProcurementException } from './procurement.errors.js';
import { PrEventsService } from './pr-events.service.js';
import { PrStateService } from './pr-state.service.js';
import {
  type CommercialSnapshot,
  PurchaseOrderService,
} from './purchase-order.service.js';

type TxClient = Prisma.TransactionClient;

export type AcceptCommerciallyParams = {
  pr: PurchaseRequest & {
    items?: Array<{
      gradeId: string;
      productId: string | null;
      offerId: string | null;
      quantity: Prisma.Decimal | number;
      unit: string;
      unitPriceSnapshot?: Prisma.Decimal | number | null;
      paymentMethod?: PaymentMethod | null;
    }>;
  };
  actorUserId: string;
  actorRole: NegotiationActorRole;
  unitPrice: number;
  quantity: number;
  paymentMethod?: PaymentMethod | null;
  negotiationRound?: number | null;
  currency?: CurrencyCode;
};

@Injectable()
export class CommercialAcceptanceService {
  constructor(
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly events: PrEventsService,
    private readonly prState: PrStateService,
    private readonly financeBootstrap: FinanceBootstrapService,
  ) {}

  buildSnapshot(params: AcceptCommerciallyParams): CommercialSnapshot {
    const item = params.pr.items?.[0];
    const quantity = params.quantity;
    const unitPrice = params.unitPrice;
    return {
      gradeId: item?.gradeId ?? null,
      productId: item?.productId ?? null,
      offerId: item?.offerId ?? null,
      quantity,
      unit: item?.unit ?? 'MT',
      unitPrice,
      totalValue: Number((quantity * unitPrice).toFixed(2)),
      paymentMethod:
        params.paymentMethod ??
        item?.paymentMethod ??
        params.pr.paymentMethod ??
        null,
      currency: params.currency ?? params.pr.currency ?? CurrencyCode.INR,
      negotiationRound: params.negotiationRound ?? null,
      acceptedByRole: params.actorRole,
      acceptedAt: new Date().toISOString(),
    };
  }

  async acceptCommercially(tx: TxClient, params: AcceptCommerciallyParams) {
    const { pr, actorUserId, actorRole } = params;

    if (pr.status === PurchaseRequestStatus.CONVERTED_TO_ORDER) {
      const existing = await tx.purchaseOrder.findFirst({
        where: { purchaseRequestId: pr.id, deletedAt: null },
      });
      if (existing) {
        await this.financeBootstrap.ensureForPurchaseOrder(tx, existing);
        return { pr, purchaseOrder: existing, idempotent: true as const };
      }
      throw new ProcurementException(
        'PO_ALREADY_CREATED',
        'Purchase request already converted but PO missing',
      );
    }

    this.prState.assertTransition(
      pr.status,
      PurchaseRequestStatus.CONVERTED_TO_ORDER,
    );

    const snapshot = this.buildSnapshot(params);
    const now = new Date();

    const updatedPr = await tx.purchaseRequest.update({
      where: { id: pr.id },
      data: {
        status: PurchaseRequestStatus.CONVERTED_TO_ORDER,
        commerciallyAcceptedAt: now,
        commercialSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        sellerRespondedAt:
          actorRole === NegotiationActorRole.SELLER
            ? (pr.sellerRespondedAt ?? now)
            : pr.sellerRespondedAt,
        targetPrice: snapshot.totalValue,
        paymentMethod: snapshot.paymentMethod,
      },
    });

    const purchaseOrder = await this.purchaseOrders.createFromAcceptedPr(
      tx,
      updatedPr,
      snapshot,
    );

    await this.financeBootstrap.createForPurchaseOrder(
      tx,
      purchaseOrder,
      snapshot,
    );

    await this.events.record(tx, {
      purchaseRequestId: pr.id,
      eventType: 'COMMERCIAL_TERMS_ACCEPTED',
      actorRole,
      actorUserId,
      metadata: { snapshot },
    });

    await this.events.record(tx, {
      purchaseRequestId: pr.id,
      eventType: 'PURCHASE_ORDER_CREATED',
      actorRole,
      actorUserId,
      metadata: {
        purchaseOrderId: purchaseOrder.id,
        referenceNumber: purchaseOrder.referenceNumber,
        status: purchaseOrder.status,
      },
    });

    return {
      pr: updatedPr,
      purchaseOrder,
      idempotent: false as const,
    };
  }
}
