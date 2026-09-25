import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SettlementStatus,
  type PurchaseOrder,
  type Settlement,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { REFERENCE_NUMBER_PREFIX } from '../../../common/enums/domain.enums.js';
import { FinanceException } from '../common/finance.errors.js';
import { toDecimal } from '../common/money.util.js';
import {
  anonymousBuyer,
  BLIND_BUYER_DISPLAY_NAME,
} from '../../sellers/common/blind-buyer.js';
import { SettlementCalculationService } from './settlement-calculation.service.js';

type TxClient = Prisma.TransactionClient;

const OUTSTANDING_STATUSES: SettlementStatus[] = [
  SettlementStatus.PENDING,
  SettlementStatus.PROCESSING,
  SettlementStatus.READY,
  SettlementStatus.ON_HOLD,
];

const SETTLEMENT_SORT_FIELDS = [
  'createdAt',
  'settlementDate',
  'grossAmount',
  'netAmount',
  'status',
] as const;

export type SettlementSortBy = (typeof SETTLEMENT_SORT_FIELDS)[number];

export type SettlementListParams = {
  organizationId?: string;
  skip: number;
  take: number;
  status?: SettlementStatus;
  search?: string;
  sortBy?: SettlementSortBy;
  sortOrder?: 'asc' | 'desc';
};

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

  private money(value: Prisma.Decimal | number | string | null | undefined) {
    return toDecimal(value).toFixed(2);
  }

  private deductionsTotal(s: {
    platformFee: Prisma.Decimal;
    tdsAmount: Prisma.Decimal;
    deductions: Prisma.Decimal;
  }) {
    return toDecimal(s.platformFee)
      .plus(toDecimal(s.tdsAmount))
      .plus(toDecimal(s.deductions))
      .toFixed(2);
  }

  private buildWhere(params: {
    organizationId?: string;
    status?: SettlementStatus;
    search?: string;
  }): Prisma.SettlementWhereInput {
    const search = params.search?.trim();
    return {
      ...(params.organizationId
        ? { organizationId: params.organizationId }
        : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(search
        ? {
            OR: [
              {
                referenceNumber: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                purchaseOrder: {
                  referenceNumber: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                purchaseOrder: {
                  financeInvoices: {
                    some: {
                      invoiceNumber: {
                        contains: search,
                        mode: 'insensitive',
                      },
                      deletedAt: null,
                    },
                  },
                },
              },
              {
                purchaseOrder: {
                  proformaInvoices: {
                    some: {
                      piNumber: {
                        contains: search,
                        mode: 'insensitive',
                      },
                      deletedAt: null,
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private listInclude() {
    return {
      purchaseOrder: {
        select: {
          id: true,
          referenceNumber: true,
          customerOrgId: true,
          orderedQuantity: true,
          currency: true,
          totalAmount: true,
          subtotal: true,
          metadata: true,
          financeInvoices: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' as const },
            take: 1,
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
            },
          },
          proformaInvoices: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' as const },
            take: 1,
            select: {
              id: true,
              piNumber: true,
              status: true,
            },
          },
          purchaseRequest: {
            select: {
              items: {
                take: 1,
                include: {
                  grade: {
                    select: {
                      code: true,
                      name: true,
                      displayName: true,
                    },
                  },
                  product: { select: { name: true, code: true } },
                },
              },
            },
          },
        },
      },
    } satisfies Prisma.SettlementInclude;
  }

  private toSellerListItem(
    s: Settlement & {
      purchaseOrder?: {
        id: string;
        referenceNumber: string;
        customerOrgId: string;
        financeInvoices: Array<{
          id: string;
          invoiceNumber: string;
          status: string;
        }>;
        proformaInvoices: Array<{
          id: string;
          piNumber: string;
          status: string;
        }>;
      } | null;
    },
  ) {
    const po = s.purchaseOrder;
    const invoice = po?.financeInvoices?.[0] ?? null;
    const proforma = po?.proformaInvoices?.[0] ?? null;
    const buyer = po?.customerOrgId
      ? anonymousBuyer(po.customerOrgId)
      : {
          displayName: BLIND_BUYER_DISPLAY_NAME,
          reference: 'BUYER-UNKNOWN',
        };

    return {
      id: s.id,
      settlementNumber: s.referenceNumber,
      referenceNumber: s.referenceNumber,
      purchaseOrderId: s.purchaseOrderId,
      orderId: s.orderId ?? s.purchaseOrderId,
      orderNumber: po?.referenceNumber ?? null,
      invoiceId: invoice?.id ?? null,
      invoiceNumber: invoice?.invoiceNumber ?? null,
      proformaInvoiceId: proforma?.id ?? null,
      proformaInvoiceNumber: proforma?.piNumber ?? null,
      status: s.status,
      currency: s.currency,
      grossAmount: this.money(s.grossAmount),
      taxAmount: this.money(s.taxAmount),
      platformFee: this.money(s.platformFee),
      tdsAmount: this.money(s.tdsAmount),
      otherDeductions: this.money(s.deductions),
      deductions: this.deductionsTotal(s),
      netAmount: this.money(s.netAmount),
      settlementDate: s.settlementDate?.toISOString() ?? null,
      releasedAt: s.releasedAt?.toISOString() ?? null,
      expectedSettlementDate: null as string | null,
      buyer,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  async list(params: SettlementListParams) {
    const where = this.buildWhere(params);
    const sortBy = SETTLEMENT_SORT_FIELDS.includes(
      (params.sortBy ?? 'createdAt') as SettlementSortBy,
    )
      ? (params.sortBy ?? 'createdAt')
      : 'createdAt';
    const sortOrder = params.sortOrder === 'asc' ? 'asc' : 'desc';

    const [rows, total] = await Promise.all([
      this.prisma.settlement.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: params.skip,
        take: params.take,
        include: this.listInclude(),
      }),
      this.prisma.settlement.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toSellerListItem(row)),
      total,
    };
  }

  async summaryForSeller(organizationId: string) {
    const [totals, byStatus, nextPending] = await Promise.all([
      this.prisma.settlement.aggregate({
        where: { organizationId },
        _sum: {
          grossAmount: true,
          netAmount: true,
        },
        _count: { _all: true },
      }),
      this.prisma.settlement.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
        _sum: {
          grossAmount: true,
          netAmount: true,
        },
      }),
      this.prisma.settlement.findFirst({
        where: {
          organizationId,
          status: SettlementStatus.PENDING,
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          referenceNumber: true,
          netAmount: true,
          settlementDate: true,
          createdAt: true,
        },
      }),
    ]);

    const statusMap = Object.fromEntries(
      byStatus.map((row) => [
        row.status,
        {
          count: row._count._all,
          grossAmount: this.money(row._sum.grossAmount),
          netAmount: this.money(row._sum.netAmount),
        },
      ]),
    );

    const settledNet = byStatus
      .filter((row) => row.status === SettlementStatus.RELEASED)
      .reduce((sum, row) => sum.plus(toDecimal(row._sum.netAmount)), toDecimal(0));

    const pendingNet = byStatus
      .filter((row) => OUTSTANDING_STATUSES.includes(row.status))
      .reduce((sum, row) => sum.plus(toDecimal(row._sum.netAmount)), toDecimal(0));

    return {
      totalSales: this.money(totals._sum.grossAmount),
      settledAmount: settledNet.toFixed(2),
      pendingSettlementAmount: pendingNet.toFixed(2),
      outstandingSettlementAmount: pendingNet.toFixed(2),
      nextSettlementAmount: nextPending
        ? this.money(nextPending.netAmount)
        : null,
      nextSettlementId: nextPending?.id ?? null,
      nextSettlementNumber: nextPending?.referenceNumber ?? null,
      totalCount: totals._count._all,
      byStatus: statusMap,
    };
  }

  async findOneForSeller(id: string, organizationId: string) {
    const settlement = await this.prisma.settlement.findFirst({
      where: { id, organizationId },
      include: {
        ...this.listInclude(),
        items: {
          orderBy: { createdAt: 'asc' },
          include: {
            payment: {
              select: {
                id: true,
                referenceNumber: true,
                status: true,
                utr: true,
                paidAt: true,
                verifiedAt: true,
                amount: true,
              },
            },
          },
        },
        transactions: {
          orderBy: { createdAt: 'asc' },
        },
        statusHistory: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!settlement) {
      throw new FinanceException('SETTLEMENT_NOT_FOUND');
    }

    const list = this.toSellerListItem(settlement);
    const po = settlement.purchaseOrder as
      | (NonNullable<typeof settlement.purchaseOrder> & {
          orderedQuantity: Prisma.Decimal | null;
          totalAmount: Prisma.Decimal;
          subtotal: Prisma.Decimal;
          metadata: Prisma.JsonValue | null;
          purchaseRequest?: {
            items: Array<{
              quantity?: Prisma.Decimal | number | null;
              unit?: string | null;
              unitPrice?: Prisma.Decimal | number | null;
              product?: { name: string; code: string } | null;
              grade?: {
                code: string;
                name: string;
                displayName: string | null;
              } | null;
            }>;
          } | null;
        })
      | null;
    const line = po?.purchaseRequest?.items?.[0] as
      | {
          quantity?: Prisma.Decimal | number | null;
          unit?: string | null;
          unitPriceSnapshot?: Prisma.Decimal | number | null;
          targetUnitPrice?: Prisma.Decimal | number | null;
          product?: { name: string; code: string } | null;
          grade?: {
            code: string;
            name: string;
            displayName: string | null;
          } | null;
        }
      | undefined;
    const snapshot = (
      po?.metadata as {
        commercialSnapshot?: {
          quantity?: number;
          unit?: string;
          unitPrice?: number;
        };
      } | null
    )?.commercialSnapshot;
    const primaryPayment = settlement.items.find((item) => item.payment)?.payment;
    const unitPriceValue =
      line?.unitPriceSnapshot ??
      line?.targetUnitPrice ??
      snapshot?.unitPrice ??
      null;

    return {
      ...list,
      relatedPurchaseOrder: po
        ? {
            id: po.id,
            referenceNumber: po.referenceNumber,
            quantity:
              po.orderedQuantity != null
                ? toDecimal(po.orderedQuantity).toFixed(3)
                : line?.quantity != null
                  ? toDecimal(line.quantity).toFixed(3)
                  : snapshot?.quantity != null
                    ? toDecimal(snapshot.quantity).toFixed(3)
                    : null,
            unit: line?.unit ?? snapshot?.unit ?? 'MT',
            unitPrice:
              unitPriceValue != null ? this.money(unitPriceValue) : null,
            orderValue:
              po.totalAmount != null ? this.money(po.totalAmount) : null,
            productName: line?.product?.name ?? null,
            gradeName:
              line?.grade?.displayName ??
              line?.grade?.name ??
              line?.grade?.code ??
              null,
          }
        : null,
      relatedInvoice: list.invoiceId
        ? {
            id: list.invoiceId,
            invoiceNumber: list.invoiceNumber,
            status: po?.financeInvoices?.[0]?.status ?? null,
          }
        : null,
      relatedProformaInvoice: list.proformaInvoiceId
        ? {
            id: list.proformaInvoiceId,
            piNumber: list.proformaInvoiceNumber,
            status: po?.proformaInvoices?.[0]?.status ?? null,
          }
        : null,
      relatedPayment: primaryPayment
        ? {
            id: primaryPayment.id,
            referenceNumber: primaryPayment.referenceNumber,
            status: primaryPayment.status,
            utr: primaryPayment.utr,
            amount: this.money(primaryPayment.amount),
            paidAt: primaryPayment.paidAt?.toISOString() ?? null,
            verifiedAt: primaryPayment.verifiedAt?.toISOString() ?? null,
          }
        : null,
      deductionBreakdown: [
        {
          code: 'PLATFORM_FEE',
          label: 'Platform Fee',
          amount: this.money(settlement.platformFee),
        },
        {
          code: 'TDS',
          label: 'Tax Withholding (TDS)',
          amount: this.money(settlement.tdsAmount),
        },
        {
          code: 'OTHER',
          label: 'Other Deduction',
          amount: this.money(settlement.deductions),
        },
      ].filter((row) => toDecimal(row.amount).gt(0)),
      items: settlement.items.map((item) => ({
        id: item.id,
        description: item.description,
        amount: this.money(item.amount),
        paymentId: item.paymentId,
        paymentReference: item.payment?.referenceNumber ?? null,
      })),
      pendingReason:
        settlement.status === SettlementStatus.PENDING
          ? 'Settlement draft is awaiting platform payout processing.'
          : settlement.status === SettlementStatus.ON_HOLD
            ? 'Settlement is on hold pending finance review.'
            : settlement.status === SettlementStatus.PROCESSING ||
                settlement.status === SettlementStatus.READY
              ? 'Settlement is queued for release to your registered bank account.'
              : null,
      timeline: await this.buildTimeline(settlement),
    };
  }

  async timelineForSeller(id: string, organizationId: string) {
    const settlement = await this.prisma.settlement.findFirst({
      where: { id, organizationId },
      include: {
        statusHistory: { orderBy: { createdAt: 'asc' } },
        purchaseOrder: { select: { id: true } },
      },
    });
    if (!settlement) {
      throw new FinanceException('SETTLEMENT_NOT_FOUND');
    }
    return {
      id: settlement.id,
      settlementNumber: settlement.referenceNumber,
      status: settlement.status,
      timeline: await this.buildTimeline(settlement),
    };
  }

  private async buildTimeline(settlement: {
    id: string;
    purchaseOrderId: string | null;
    status: SettlementStatus;
    createdAt: Date;
    settlementDate: Date | null;
    releasedAt: Date | null;
    statusHistory: Array<{
      id: string;
      fromStatus: SettlementStatus | null;
      toStatus: SettlementStatus;
      notes: string | null;
      createdAt: Date;
    }>;
  }) {
    const events: Array<{
      id: string;
      event: string;
      label: string;
      description: string | null;
      status: 'completed' | 'current' | 'pending';
      at: string;
      source: string;
    }> = [];

    if (settlement.purchaseOrderId) {
      const financeEvents = await this.prisma.financeEvent.findMany({
        where: { purchaseOrderId: settlement.purchaseOrderId },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      for (const fe of financeEvents) {
        events.push({
          id: fe.id,
          event: fe.eventType,
          label: this.humanizeEvent(fe.eventType),
          description: null,
          status: 'completed',
          at: fe.createdAt.toISOString(),
          source: 'finance_event',
        });
      }
    }

    for (const history of settlement.statusHistory) {
      events.push({
        id: history.id,
        event: `SETTLEMENT_${history.toStatus}`,
        label: this.humanizeSettlementStatus(history.toStatus),
        description: history.notes,
        status: 'completed',
        at: history.createdAt.toISOString(),
        source: 'settlement_status_history',
      });
    }

    if (events.length === 0) {
      events.push({
        id: `${settlement.id}-created`,
        event: 'SETTLEMENT_CREATED',
        label: 'Settlement Created',
        description: 'Settlement record created',
        status: 'completed',
        at: settlement.createdAt.toISOString(),
        source: 'settlement',
      });
    }

    if (
      settlement.releasedAt &&
      !events.some((e) => e.event === 'SETTLEMENT_RELEASED')
    ) {
      events.push({
        id: `${settlement.id}-released`,
        event: 'SETTLEMENT_RELEASED',
        label: 'Settlement Completed',
        description: null,
        status: 'completed',
        at: settlement.releasedAt.toISOString(),
        source: 'settlement',
      });
    }

    events.sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );

    if (events.length > 0) {
      const last = events[events.length - 1];
      if (
        last &&
        OUTSTANDING_STATUSES.includes(settlement.status) &&
        last.status === 'completed'
      ) {
        last.status = 'current';
      }
    }

    return events;
  }

  private humanizeEvent(eventType: string) {
    return eventType
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private humanizeSettlementStatus(status: SettlementStatus) {
    switch (status) {
      case SettlementStatus.PENDING:
        return 'Settlement Created';
      case SettlementStatus.PROCESSING:
        return 'Settlement Processing';
      case SettlementStatus.READY:
        return 'Settlement Ready';
      case SettlementStatus.RELEASED:
        return 'Settlement Completed';
      case SettlementStatus.FAILED:
        return 'Settlement Failed';
      case SettlementStatus.CANCELLED:
        return 'Settlement Cancelled';
      case SettlementStatus.ON_HOLD:
        return 'Settlement On Hold';
      default:
        return this.humanizeEvent(status);
    }
  }
}
