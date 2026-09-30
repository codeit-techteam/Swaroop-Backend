import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NegotiationActorRole,
  Prisma,
  PurchaseRequestStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  NegotiationService,
  PrEventsService,
  ProcurementException,
  PrStateService,
} from '../../procurement/index.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../../master-data/common/pagination.js';
import type {
  AdminCancelDto,
  AdminNoteDto,
  AdminProcurementMutationDto,
  AdminProcurementPrQueryDto,
} from './admin-procurement.dto.js';
import {
  bucketWhere,
  needsActionWhere,
  OPEN_PURCHASE_ORDER_STATUSES,
  pendingInvoiceWhere,
  urgentWhere,
} from './admin-procurement.query.js';
import {
  activityMessage,
  csvCell,
  deriveProcurementAction,
  paymentStatusLabel,
  proformaStatusLabel,
  purchaseOrderStatusLabel,
  purchaseRequestStatusLabel,
  type WorkbenchBucket,
} from './admin-procurement.signals.js';

const orgSelect = {
  id: true,
  name: true,
  code: true,
  type: true,
  legalName: true,
  email: true,
  phone: true,
  verificationStatus: true,
} as const;

const purchaseOrderSelect = {
  id: true,
  referenceNumber: true,
  status: true,
  subtotal: true,
  taxAmount: true,
  totalAmount: true,
  paymentMethod: true,
  orderedQuantity: true,
  confirmedAt: true,
  shippingAddressSnapshot: true,
  billingAddressSnapshot: true,
  createdAt: true,
  proformaInvoices: {
    where: { deletedAt: null },
    take: 1,
    orderBy: { createdAt: 'desc' as const },
    select: {
      id: true,
      piNumber: true,
      status: true,
      totalAmount: true,
      paidAmount: true,
      remainingAmount: true,
      dueDate: true,
      currency: true,
    },
  },
  dispatches: {
    where: { deletedAt: null },
    take: 1,
    orderBy: { createdAt: 'desc' as const },
    select: { id: true, dispatchNumber: true, status: true },
  },
  shipments: {
    where: { deletedAt: null },
    take: 1,
    orderBy: { createdAt: 'desc' as const },
    select: { id: true, referenceNumber: true, status: true, eta: true },
  },
  ewayBills: {
    take: 1,
    orderBy: { createdAt: 'desc' as const },
    select: { id: true, ewayBillNumber: true, status: true },
  },
} satisfies Prisma.PurchaseOrderSelect;

const adminPrInclude = {
  customerOrg: { select: orgSelect },
  sellerOrg: {
    select: {
      ...orgSelect,
      sellerProfile: {
        select: {
          id: true,
          status: true,
          onboarding: { select: { status: true } },
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
        },
      },
    },
  },
  customerProfile: {
    select: {
      id: true,
      status: true,
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
        },
      },
    },
  },
  items: {
    include: {
      grade: {
        select: { id: true, code: true, name: true, displayName: true },
      },
      product: { select: { id: true, code: true, name: true } },
      offer: { select: { id: true, referenceNumber: true } },
    },
  },
  sellerMatches: {
    orderBy: { matchedAt: 'asc' as const },
    include: {
      sellerOrg: { select: orgSelect },
      offer: {
        select: {
          id: true,
          referenceNumber: true,
          basePrice: true,
          currency: true,
        },
      },
    },
  },
  counterOffers: {
    orderBy: [{ roundNumber: 'asc' as const }, { createdAt: 'asc' as const }],
  },
  purchaseOrders: {
    where: { deletedAt: null },
    take: 1,
    select: purchaseOrderSelect,
  },
  _count: { select: { events: true } },
} satisfies Prisma.PurchaseRequestInclude;

@Injectable()
export class AdminProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prState: PrStateService,
    private readonly prEvents: PrEventsService,
    private readonly negotiation: NegotiationService,
  ) {}

  async summary() {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const inFiveMin = new Date(now.getTime() + 5 * 60 * 1000);

    const [
      total,
      sourcing,
      negotiation,
      converted,
      rejected,
      expired,
      cancelled,
      expiringSoon,
      acceptedToday,
      pendingCounters,
      pendingApprovals,
      pendingSellerResponses,
      needsAction,
      urgent,
      pendingInvoice,
      approved,
      openPoValue,
    ] = await Promise.all([
      this.prisma.purchaseRequest.count({ where: { deletedAt: null } }),
      this.prisma.purchaseRequest.count({
        where: { deletedAt: null, status: PurchaseRequestStatus.SOURCING },
      }),
      this.prisma.purchaseRequest.count({
        where: { deletedAt: null, status: PurchaseRequestStatus.NEGOTIATION },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          status: PurchaseRequestStatus.CONVERTED_TO_ORDER,
        },
      }),
      this.prisma.purchaseRequest.count({
        where: { deletedAt: null, status: PurchaseRequestStatus.REJECTED },
      }),
      this.prisma.purchaseRequest.count({
        where: { deletedAt: null, status: PurchaseRequestStatus.EXPIRED },
      }),
      this.prisma.purchaseRequest.count({
        where: { deletedAt: null, status: PurchaseRequestStatus.CANCELLED },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          status: {
            in: [
              PurchaseRequestStatus.SOURCING,
              PurchaseRequestStatus.NEGOTIATION,
              PurchaseRequestStatus.OFFER_RECEIVED,
            ],
          },
          responseDeadline: { gt: now, lte: inFiveMin },
        },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          status: PurchaseRequestStatus.CONVERTED_TO_ORDER,
          commerciallyAcceptedAt: { gte: startOfDay },
        },
      }),
      this.prisma.counterOffer.count({
        where: { status: 'PENDING' },
      }),
      this.prisma.purchaseRequest.count({
        where: { deletedAt: null, status: PurchaseRequestStatus.PENDING_APPROVAL },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          status: {
            in: [
              PurchaseRequestStatus.SUBMITTED,
              PurchaseRequestStatus.SOURCING,
              PurchaseRequestStatus.OFFER_RECEIVED,
            ],
          },
          sellerRespondedAt: null,
        },
      }),
      this.prisma.purchaseRequest.count({
        where: { deletedAt: null, ...needsActionWhere(now) },
      }),
      this.prisma.purchaseRequest.count({
        where: { deletedAt: null, ...urgentWhere(now) },
      }),
      this.prisma.purchaseRequest.count({
        where: { deletedAt: null, ...pendingInvoiceWhere() },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          status: {
            in: [
              PurchaseRequestStatus.APPROVED,
              PurchaseRequestStatus.CONVERTED_TO_ORDER,
            ],
          },
        },
      }),
      this.prisma.purchaseOrder.aggregate({
        where: {
          deletedAt: null,
          status: { in: OPEN_PURCHASE_ORDER_STATUSES },
        },
        _sum: { totalAmount: true },
      }),
    ]);

    return {
      total,
      byStatus: {
        sourcing,
        negotiation,
        convertedToOrder: converted,
        rejected,
        expired,
        cancelled,
      },
      expiringSoon,
      acceptedToday,
      pendingCounters,
      pendingApprovals,
      pendingSellerResponses,
      activeNegotiations: negotiation,
      openPoValue: (openPoValue._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(
        2,
      ),
      counts: {
        all: total,
        needsAction,
        negotiation,
        urgent,
        pendingInvoice,
        approved,
        pendingApprovals,
        pendingSellerResponses,
      },
    };
  }

  async list(query: AdminProcurementPrQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where = this.buildWhere(query);

    const [total, items] = await this.prisma.$transaction([
      this.prisma.purchaseRequest.count({ where }),
      this.prisma.purchaseRequest.findMany({
        where,
        include: adminPrInclude,
        orderBy: this.orderBy(query),
        skip,
        take,
      }),
    ]);

    return {
      items: items.map((pr) => this.toAdminPr(pr)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async activity(limit = 20) {
    const take = Math.min(50, Math.max(1, limit));
    const events = await this.prisma.purchaseRequestEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        purchaseRequest: { select: { id: true, referenceNumber: true } },
      },
    });
    const userIds = [
      ...new Set(
        events
          .map((event) => event.actorUserId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const names = new Map(
      users.map((user) => [
        user.id,
        [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
      ]),
    );

    return {
      items: events.map((event) => ({
        id: event.id,
        type: event.eventType,
        message: activityMessage(
          event.eventType,
          event.purchaseRequest.referenceNumber,
        ),
        actorName: event.actorUserId
          ? (names.get(event.actorUserId) ?? event.actorRole ?? 'System')
          : (event.actorRole ?? 'System'),
        actorRole: event.actorRole,
        referenceNumber: event.purchaseRequest.referenceNumber,
        purchaseRequestId: event.purchaseRequestId,
        createdAt: event.createdAt,
      })),
    };
  }

  async queue() {
    const now = new Date();
    const groups: Array<{ key: WorkbenchBucket; label: string }> = [
      { key: 'needs_action', label: 'Needs action' },
      { key: 'negotiation', label: 'Negotiation' },
      { key: 'pending_approvals', label: 'Admin approval' },
      { key: 'pending_invoice', label: 'Invoice / payment' },
      { key: 'pending_seller', label: 'Seller response pending' },
    ];
    const loaded = await Promise.all(
      groups.map(async (group) => {
        const where = this.buildWhere({ bucket: group.key });
        const [count, items] = await this.prisma.$transaction([
          this.prisma.purchaseRequest.count({ where }),
          this.prisma.purchaseRequest.findMany({
            where,
            include: adminPrInclude,
            orderBy: { updatedAt: 'desc' },
            take: 8,
          }),
        ]);
        return {
          key: group.key,
          label: group.label,
          count,
          items: items.map((pr) => this.toAdminPr(pr, now)),
        };
      }),
    );
    return { groups: loaded.filter((group) => group.count > 0) };
  }

  async exportCsv(query: AdminProcurementPrQueryDto) {
    const where = this.buildWhere(query);
    const items = await this.prisma.purchaseRequest.findMany({
      where,
      include: adminPrInclude,
      orderBy: this.orderBy(query),
      take: 5000,
    });
    const header = [
      'PR Number',
      'PO Number',
      'Customer',
      'Seller',
      'Grade',
      'Product',
      'Quantity',
      'Unit',
      'Unit Price',
      'Total',
      'Payment Terms',
      'Status',
      'Action',
      'Created At',
      'Updated At',
    ];
    const lines = items.map((pr) => {
      const row = this.toAdminPr(pr);
      return [
        row.referenceNumber,
        row.ops.poNumber ?? '',
        row.ops.customerName,
        row.ops.sellerName ?? '',
        row.ops.gradeName,
        row.ops.productName,
        row.ops.quantity,
        row.ops.unit,
        row.ops.unitPrice ?? '',
        row.ops.totalAmount ?? '',
        row.ops.paymentTerms ?? '',
        row.status,
        row.ops.actionReason ?? '',
        row.createdAt.toISOString(),
        row.updatedAt.toISOString(),
      ]
        .map((cell) => csvCell(cell))
        .join(',');
    });
    return {
      filename: 'petrotrade-procurement-export.csv',
      csv: [header.join(','), ...lines].join('\n'),
      rowCount: items.length,
    };
  }

  async findOne(id: string) {
    const pr = await this.prisma.purchaseRequest.findFirst({
      where: { id, deletedAt: null },
      include: adminPrInclude,
    });
    if (!pr) throw new NotFoundException('Purchase request not found');
    return this.toAdminPr(pr);
  }

  async timeline(id: string) {
    await this.ensureExists(id);
    const events = await this.prisma.purchaseRequestEvent.findMany({
      where: { purchaseRequestId: id },
      orderBy: { createdAt: 'asc' },
    });
    return { purchaseRequestId: id, events };
  }

  async negotiationHistory(id: string) {
    await this.ensureExists(id);
    const rounds = await this.negotiation.list(id);
    return {
      purchaseRequestId: id,
      rounds: this.negotiation.toAdminNegotiation(rounds),
    };
  }

  async addNote(id: string, actorUserId: string, dto: AdminNoteDto) {
    await this.ensureExists(id);
    await this.prEvents.record(this.prisma, {
      purchaseRequestId: id,
      eventType: 'ADMIN_NOTE_ADDED',
      actorRole: NegotiationActorRole.ADMIN,
      actorUserId,
      metadata: { note: dto.note },
    });
    return this.findOne(id);
  }

  async markReview(
    id: string,
    actorUserId: string,
    dto: AdminProcurementMutationDto = {},
  ) {
    const existing = await this.ensureExists(id);
    this.assertFresh(existing.updatedAt, dto.expectedUpdatedAt);
    await this.prEvents.record(this.prisma, {
      purchaseRequestId: id,
      eventType: 'ADMIN_MARKED_FOR_REVIEW',
      actorRole: NegotiationActorRole.ADMIN,
      actorUserId,
    });
    const pr = await this.prisma.purchaseRequest.update({
      where: { id },
      data: {
        metadata: {
          ...((existing.metadata as object) ?? {}),
          adminReview: true,
          markedForReviewAt: new Date().toISOString(),
        },
      },
      include: adminPrInclude,
    });
    return this.toAdminPr(pr);
  }

  async escalate(
    id: string,
    actorUserId: string,
    dto: AdminProcurementMutationDto = {},
  ) {
    const existing = await this.ensureExists(id);
    this.assertFresh(existing.updatedAt, dto.expectedUpdatedAt);
    await this.prEvents.record(this.prisma, {
      purchaseRequestId: id,
      eventType: 'ADMIN_ESCALATED',
      actorRole: NegotiationActorRole.ADMIN,
      actorUserId,
    });
    const pr = await this.prisma.purchaseRequest.update({
      where: { id },
      data: {
        priority: 'URGENT',
        metadata: {
          ...((existing.metadata as object) ?? {}),
          escalated: true,
          escalatedAt: new Date().toISOString(),
        },
      },
      include: adminPrInclude,
    });
    return this.toAdminPr(pr);
  }

  async cancel(id: string, actorUserId: string, dto: AdminCancelDto) {
    const pr = await this.ensureExists(id);
    this.assertFresh(pr.updatedAt, dto.expectedUpdatedAt);
    if (pr.status === PurchaseRequestStatus.CONVERTED_TO_ORDER) {
      throw new BadRequestException({
        code: 'INVALID_STATUS_TRANSITION',
        message:
          'Cannot cancel a purchase request that has been converted to order',
      });
    }
    if (this.prState.isTerminal(pr.status)) {
      throw new ProcurementException(
        'PURCHASE_REQUEST_ALREADY_RESPONDED',
        `Cannot cancel purchase request in status ${pr.status}`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.purchaseRequest.update({
        where: { id },
        data: {
          status: PurchaseRequestStatus.CANCELLED,
          rejectionReason: dto.reason,
        },
        include: adminPrInclude,
      });
      await this.prEvents.record(tx, {
        purchaseRequestId: id,
        eventType: 'PURCHASE_REQUEST_CANCELLED',
        actorRole: NegotiationActorRole.ADMIN,
        actorUserId,
        metadata: { reason: dto.reason },
      });
      return next;
    });

    return this.toAdminPr(updated);
  }

  private async ensureExists(id: string) {
    const pr = await this.prisma.purchaseRequest.findFirst({
      where: { id, deletedAt: null },
    });
    if (!pr) throw new NotFoundException('Purchase request not found');
    return pr;
  }

  private assertFresh(updatedAt: Date, expectedUpdatedAt?: string) {
    if (!expectedUpdatedAt) return;
    const expected = new Date(expectedUpdatedAt).getTime();
    if (Number.isNaN(expected) || expected !== updatedAt.getTime()) {
      throw new ConflictException(
        'This procurement has already been updated by another user. Refresh and review the latest status.',
      );
    }
  }

  async recordView(id: string, actorUserId: string) {
    await this.ensureExists(id);
    await this.prEvents.record(this.prisma, {
      purchaseRequestId: id,
      eventType: 'PROCUREMENT_VIEWED',
      actorRole: NegotiationActorRole.ADMIN,
      actorUserId,
    });
    return { recorded: true };
  }

  private buildWhere(
    query: Pick<
      AdminProcurementPrQueryDto,
      | 'status'
      | 'bucket'
      | 'priority'
      | 'customerId'
      | 'sellerId'
      | 'customer'
      | 'seller'
      | 'gradeId'
      | 'productId'
      | 'paymentOption'
      | 'dateFrom'
      | 'dateTo'
      | 'search'
      | 'q'
    >,
  ): Prisma.PurchaseRequestWhereInput {
    const search = resolveSearch(query);
    const and: Prisma.PurchaseRequestWhereInput[] = [{ deletedAt: null }];
    if (query.status) and.push({ status: query.status });
    if (query.priority) and.push({ priority: query.priority });
    if (query.customerId) and.push({ customerOrgId: query.customerId });
    if (query.sellerId) and.push({ sellerOrgId: query.sellerId });
    if (query.customer?.trim()) {
      const customer = query.customer.trim();
      and.push({
        OR: [
          { customerOrg: { name: { contains: customer, mode: 'insensitive' } } },
          {
            customerOrg: {
              legalName: { contains: customer, mode: 'insensitive' },
            },
          },
        ],
      });
    }
    if (query.seller?.trim()) {
      const seller = query.seller.trim();
      and.push({
        OR: [
          { sellerOrg: { name: { contains: seller, mode: 'insensitive' } } },
          {
            sellerOrg: { legalName: { contains: seller, mode: 'insensitive' } },
          },
        ],
      });
    }
    if (query.paymentOption) and.push({ paymentMethod: query.paymentOption });
    if (query.gradeId) {
      and.push({ items: { some: { gradeId: query.gradeId } } });
    }
    if (query.productId) {
      and.push({ items: { some: { productId: query.productId } } });
    }
    if (query.dateFrom || query.dateTo) {
      and.push({
        createdAt: {
          ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
          ...(query.dateTo ? { lte: this.endOfRange(query.dateTo) } : {}),
        },
      });
    }
    if (search) {
      and.push({
        OR: [
          { referenceNumber: { contains: search, mode: 'insensitive' } },
          { customerOrg: { name: { contains: search, mode: 'insensitive' } } },
          {
            customerOrg: {
              legalName: { contains: search, mode: 'insensitive' },
            },
          },
          { sellerOrg: { name: { contains: search, mode: 'insensitive' } } },
          {
            sellerOrg: {
              legalName: { contains: search, mode: 'insensitive' },
            },
          },
          {
            purchaseOrders: {
              some: {
                referenceNumber: { contains: search, mode: 'insensitive' },
              },
            },
          },
          {
            items: {
              some: {
                OR: [
                  { grade: { name: { contains: search, mode: 'insensitive' } } },
                  { grade: { code: { contains: search, mode: 'insensitive' } } },
                  {
                    grade: {
                      displayName: { contains: search, mode: 'insensitive' },
                    },
                  },
                  {
                    product: { name: { contains: search, mode: 'insensitive' } },
                  },
                  {
                    product: { code: { contains: search, mode: 'insensitive' } },
                  },
                ],
              },
            },
          },
        ],
      });
    }
    const bucket = bucketWhere(query.bucket, new Date());
    if (bucket) and.push(bucket);
    return { AND: and };
  }

  private endOfRange(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T23:59:59.999Z`);
    }
    return new Date(value);
  }

  private orderBy(
    query: AdminProcurementPrQueryDto,
  ): Prisma.PurchaseRequestOrderByWithRelationInput {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    if (query.sortBy === 'updatedAt') return { updatedAt: direction };
    if (query.sortBy === 'referenceNumber') return { referenceNumber: direction };
    if (query.sortBy === 'priority') return { priority: direction };
    return { createdAt: direction };
  }

  private toAdminPr(
    pr: Prisma.PurchaseRequestGetPayload<{ include: typeof adminPrInclude }>,
    now = new Date(),
  ) {
    const purchaseOrder = pr.purchaseOrders?.[0] ?? null;
    const proforma = purchaseOrder?.proformaInvoices?.[0] ?? null;
    const dispatch = purchaseOrder?.dispatches?.[0] ?? null;
    const shipment = purchaseOrder?.shipments?.[0] ?? null;
    const ewayBill = purchaseOrder?.ewayBills?.[0] ?? null;
    const snapshot = readJson(pr.commercialSnapshot);
    const firstItem = pr.items[0];
    const quantity = pr.items.reduce(
      (sum, item) => sum.add(item.quantity),
      new Prisma.Decimal(0),
    );
    const unitPrice = money(
      snapshotNumber(snapshot, 'unitPrice') ??
        firstItem?.unitPriceSnapshot ??
        firstItem?.targetUnitPrice ??
        pr.targetPrice,
    );
    const totalAmount = money(
      snapshotNumber(snapshot, 'totalValue') ??
        (unitPrice ? quantity.mul(unitPrice) : null),
    );
    const action = deriveProcurementAction(
      {
        status: pr.status,
        priority: pr.priority,
        responseDeadline: pr.responseDeadline,
        sellerRespondedAt: pr.sellerRespondedAt,
        hasPurchaseOrder: Boolean(purchaseOrder),
        piStatus: proforma?.status ?? null,
        piDueDate: proforma?.dueDate ?? null,
        piRemainingAmount: proforma ? money(proforma.remainingAmount) : null,
      },
      now,
    );
    const customerName =
      pr.customerOrg?.legalName ?? pr.customerOrg?.name ?? 'Customer';
    const sellerName = pr.sellerOrg?.legalName ?? pr.sellerOrg?.name ?? null;
    const gradeName =
      firstItem?.grade.displayName ??
      firstItem?.grade.name ??
      firstItem?.grade.code ??
      '—';
    const productName = firstItem?.product?.name ?? firstItem?.product?.code ?? '—';

    return {
      id: pr.id,
      referenceNumber: pr.referenceNumber,
      status: pr.status,
      priority: pr.priority,
      paymentMethod: pr.paymentMethod,
      targetPrice: pr.targetPrice,
      currency: pr.currency,
      requiredByDate: pr.requiredByDate,
      destinationRegion: pr.destinationRegion,
      deliveryLocation: pr.deliveryLocation,
      shippingAddressSnapshot: pr.shippingAddressSnapshot,
      billingAddressSnapshot: pr.billingAddressSnapshot,
      notes: pr.notes,
      rejectionReason: pr.rejectionReason,
      expiresAt: pr.expiresAt,
      responseDeadline: pr.responseDeadline,
      remainingSeconds: this.prState.remainingSeconds(
        this.prState.deadlineOf(pr),
      ),
      viewedBySellerAt: pr.viewedBySellerAt,
      sellerRespondedAt: pr.sellerRespondedAt,
      commerciallyAcceptedAt: pr.commerciallyAcceptedAt,
      commercialSnapshot: pr.commercialSnapshot,
      submittedAt: pr.submittedAt,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      metadata: pr.metadata,
      customerOrg: pr.customerOrg
        ? {
            id: pr.customerOrg.id,
            name: pr.customerOrg.name,
            code: pr.customerOrg.code,
            type: pr.customerOrg.type,
            legalName: pr.customerOrg.legalName,
            email: pr.customerOrg.email,
            phone: pr.customerOrg.phone,
            verificationStatus: pr.customerOrg.verificationStatus,
          }
        : null,
      sellerOrg: pr.sellerOrg
        ? {
            id: pr.sellerOrg.id,
            name: pr.sellerOrg.name,
            code: pr.sellerOrg.code,
            type: pr.sellerOrg.type,
            legalName: pr.sellerOrg.legalName,
            email: pr.sellerOrg.email,
            phone: pr.sellerOrg.phone,
            verificationStatus: pr.sellerOrg.verificationStatus,
            sellerProfile: pr.sellerOrg.sellerProfile
              ? {
                  id: pr.sellerOrg.sellerProfile.id,
                  status: pr.sellerOrg.sellerProfile.status,
                  kycStatus: pr.sellerOrg.sellerProfile.onboarding?.status ?? null,
                  user: pr.sellerOrg.sellerProfile.user,
                }
              : null,
          }
        : null,
      customerProfile: pr.customerProfile
        ? {
            id: pr.customerProfile.id,
            status: pr.customerProfile.status,
            user: pr.customerProfile.user
              ? {
                  id: pr.customerProfile.user.id,
                  email: pr.customerProfile.user.email,
                  firstName: pr.customerProfile.user.firstName,
                  lastName: pr.customerProfile.user.lastName,
                  phone: pr.customerProfile.user.phone,
                }
              : null,
          }
        : null,
      items: pr.items,
      matchedSellers: (pr.sellerMatches ?? []).map((match) => ({
        id: match.id,
        status: match.status,
        matchedAt: match.matchedAt,
        responseDeadline: match.responseDeadline,
        viewedAt: match.viewedAt,
        respondedAt: match.respondedAt,
        matchStrategy: match.matchStrategy,
        sellerOfferPrice: match.sellerOfferPrice,
        sellerCounterPrice: match.sellerCounterPrice,
        sellerOrg: match.sellerOrg
          ? {
              id: match.sellerOrg.id,
              name: match.sellerOrg.name,
              code: match.sellerOrg.code,
              type: match.sellerOrg.type,
              legalName: match.sellerOrg.legalName,
            }
          : null,
        offer: match.offer,
      })),
      counterOffers: this.negotiation.toAdminNegotiation(pr.counterOffers),
      purchaseOrder,
      finance: {
        proforma: proforma
          ? {
              id: proforma.id,
              piNumber: proforma.piNumber,
              status: proforma.status,
              statusLabel: proformaStatusLabel(proforma.status),
              totalAmount: money(proforma.totalAmount),
              paidAmount: money(proforma.paidAmount),
              remainingAmount: money(proforma.remainingAmount),
              dueDate: proforma.dueDate,
              currency: proforma.currency,
            }
          : null,
        dispatch,
        shipment,
        ewayBill,
      },
      ops: {
        statusLabel: purchaseRequestStatusLabel(pr.status),
        ...action,
        customerName,
        sellerName,
        gradeName,
        productName,
        quantity: quantity.toFixed(3),
        unit: firstItem?.unit ?? 'MT',
        unitPrice,
        totalAmount,
        paymentTerms: pr.paymentMethod,
        poNumber: purchaseOrder?.referenceNumber ?? null,
        poStatus: purchaseOrder?.status ?? null,
        poStatusLabel: purchaseOrderStatusLabel(purchaseOrder?.status),
        piStatus: proforma?.status ?? null,
        piStatusLabel: proformaStatusLabel(proforma?.status),
        paymentStatusLabel: paymentStatusLabel({
          piStatus: proforma?.status,
          piRemainingAmount: proforma ? money(proforma.remainingAmount) : null,
        }),
      },
      eventCount: pr._count.events,
    };
  }
}

function money(
  value: Prisma.Decimal | number | string | null | undefined,
) {
  if (value == null || value === '') return null;
  try {
    return new Prisma.Decimal(value).toFixed(2);
  } catch {
    return null;
  }
}

function readJson(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function snapshotNumber(snapshot: Record<string, unknown> | null, key: string) {
  const value = snapshot?.[key];
  if (typeof value === 'number' || typeof value === 'string') return value;
  return null;
}
