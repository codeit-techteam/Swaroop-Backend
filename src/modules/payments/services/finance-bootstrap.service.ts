import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type PurchaseOrder,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { CommercialSnapshot } from '../../procurement/common/purchase-order.service.js';
import { FinanceEventsService } from '../common/finance-events.service.js';
import { CreditEligibilityService } from './credit-eligibility.service.js';
import { PaymentScheduleService } from './payment-schedule.service.js';
import { ProformaInvoiceService } from './proforma-invoice.service.js';

type TxClient = Prisma.TransactionClient;

@Injectable()
export class FinanceBootstrapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credit: CreditEligibilityService,
    private readonly proformas: ProformaInvoiceService,
    private readonly schedules: PaymentScheduleService,
    private readonly events: FinanceEventsService,
  ) {}

  /**
   * Idempotent: creates PI + payment schedules for a PO if missing.
   * Validates credit for CREDIT_15 / CREDIT_30.
   */
  async createForPurchaseOrder(
    tx: TxClient,
    purchaseOrder: PurchaseOrder,
    snapshot: CommercialSnapshot,
  ) {
    const existingPi = await tx.proformaInvoice.findUnique({
      where: { purchaseOrderId: purchaseOrder.id },
      include: {
        paymentSchedules: { orderBy: { sequence: 'asc' } },
        lines: true,
      },
    });

    if (existingPi) {
      if (existingPi.paymentSchedules.length === 0) {
        await this.schedules.createFromPo(
          tx,
          purchaseOrder,
          existingPi.id,
          existingPi.totalAmount,
        );
      }
      return {
        proformaInvoice: existingPi,
        idempotent: true as const,
      };
    }

    if (this.credit.requiresCreditCheck(snapshot.paymentMethod)) {
      await this.credit.assertEligible(
        tx,
        purchaseOrder.customerOrgId,
        snapshot.totalValue,
      );
    }

    const [customerOrg, sellerOrg] = await Promise.all([
      tx.organization.findUnique({
        where: { id: purchaseOrder.customerOrgId },
        select: { id: true, name: true, legalName: true },
      }),
      tx.organization.findUnique({
        where: { id: purchaseOrder.sellerOrgId },
        select: { id: true, name: true, legalName: true },
      }),
    ]);

    const billingSnapshot = {
      organizationId: customerOrg?.id,
      legalName: customerOrg?.legalName ?? customerOrg?.name ?? null,
    };
    const shippingSnapshot = {
      organizationId: sellerOrg?.id,
      legalName: sellerOrg?.legalName ?? sellerOrg?.name ?? null,
    };

    const pi = await this.proformas.createIssued(
      tx,
      purchaseOrder,
      snapshot,
      billingSnapshot as Prisma.InputJsonValue,
      shippingSnapshot as Prisma.InputJsonValue,
    );

    await this.schedules.createFromPo(tx, purchaseOrder, pi.id, pi.totalAmount);

    await this.events.record(tx, {
      purchaseOrderId: purchaseOrder.id,
      eventType: 'PROFORMA_INVOICE_CREATED',
      actorRole: snapshot.acceptedByRole,
      metadata: {
        proformaInvoiceId: pi.id,
        piNumber: pi.piNumber,
      },
    });

    await this.events.record(tx, {
      purchaseOrderId: purchaseOrder.id,
      eventType: 'PROFORMA_INVOICE_ISSUED',
      actorRole: snapshot.acceptedByRole,
      metadata: {
        proformaInvoiceId: pi.id,
        piNumber: pi.piNumber,
        status: pi.status,
      },
    });

    return {
      proformaInvoice: pi,
      idempotent: false as const,
    };
  }

  /** Ensure PI/schedules exist for an already-created PO (idempotent accept path). */
  async ensureForPurchaseOrder(tx: TxClient, purchaseOrder: PurchaseOrder) {
    const meta = purchaseOrder.metadata as {
      commercialSnapshot?: CommercialSnapshot;
    } | null;

    const snapshot: CommercialSnapshot = meta?.commercialSnapshot ?? {
      gradeId: null,
      productId: null,
      offerId: null,
      quantity: Number(purchaseOrder.totalAmount),
      unit: 'MT',
      unitPrice: 0,
      totalValue: Number(purchaseOrder.totalAmount),
      paymentMethod: purchaseOrder.paymentMethod,
      currency: purchaseOrder.currency,
      negotiationRound: null,
      acceptedByRole: 'SYSTEM',
      acceptedAt: new Date().toISOString(),
    };

    // Prefer PO totals when snapshot total differs
    if (!meta?.commercialSnapshot) {
      snapshot.totalValue = Number(purchaseOrder.totalAmount);
    }

    return this.createForPurchaseOrder(tx, purchaseOrder, snapshot);
  }
}
