import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CounterOfferStatus,
  EntityOwnerType,
  NegotiationActorRole,
  Prisma,
  PurchaseRequestStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  CommercialAcceptanceService,
  NegotiationService,
  PrEventsService,
  ProcurementException,
  PrStateService,
} from '../../procurement/index.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import {
  assertAvailability,
  assertMarketplaceOffer,
  MarketplaceException,
  resolveOfferUnitPrice,
  toCustomerFacingPr,
} from '../common/blind-marketplace.mapper.js';
import { CustomerAuditService } from '../common/customer-audit.service.js';
import {
  CustomerContext,
  CustomerContextService,
  nextPrReference,
  PR_RESPONSE_WINDOW_MS,
} from '../common/customer-context.service.js';
import { CartService } from '../cart/cart.service.js';
import { offerInclude } from '../marketplace/marketplace.service.js';
import type {
  CreatePurchaseRequestDto,
  CustomerCounterOfferDto,
  CustomerPurchaseRequestQueryDto,
} from './purchase-requests.dto.js';

const PENDING_STATUSES = new Set<PurchaseRequestStatus>([
  PurchaseRequestStatus.SOURCING,
  PurchaseRequestStatus.SUBMITTED,
  PurchaseRequestStatus.UNDER_REVIEW,
  PurchaseRequestStatus.NEGOTIATION,
  PurchaseRequestStatus.OFFER_RECEIVED,
]);

const TERMINAL_STATUSES = new Set<PurchaseRequestStatus>([
  PurchaseRequestStatus.APPROVED,
  PurchaseRequestStatus.REJECTED,
  PurchaseRequestStatus.CANCELLED,
  PurchaseRequestStatus.EXPIRED,
  PurchaseRequestStatus.CONVERTED_TO_ORDER,
  PurchaseRequestStatus.WITHDRAWN,
]);

const prInclude = {
  items: {
    include: {
      grade: {
        select: { id: true, code: true, name: true, displayName: true },
      },
      product: { select: { id: true, code: true, name: true } },
      offer: { select: { id: true, referenceNumber: true } },
    },
  },
  responses: {
    orderBy: { createdAt: 'desc' as const },
    select: {
      id: true,
      type: true,
      message: true,
      counterPrice: true,
      counterQuantity: true,
      currency: true,
      validUntil: true,
      createdAt: true,
    },
  },
  counterOffers: {
    orderBy: [{ roundNumber: 'asc' as const }, { createdAt: 'asc' as const }],
  },
  purchaseOrders: {
    where: { deletedAt: null },
    take: 1,
    select: { id: true, referenceNumber: true, status: true },
  },
} satisfies Prisma.PurchaseRequestInclude;

type PrWithIncludes = Prisma.PurchaseRequestGetPayload<{
  include: typeof prInclude;
}>;

@Injectable()
export class PurchaseRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerContext: CustomerContextService,
    private readonly audit: CustomerAuditService,
    private readonly cartService: CartService,
    private readonly prState: PrStateService,
    private readonly prEvents: PrEventsService,
    private readonly negotiationService: NegotiationService,
    private readonly commercialAcceptance: CommercialAcceptanceService,
  ) {}

  private async ctx(userId: string) {
    return this.customerContext.requireCustomer(userId);
  }

  private scope(ctx: CustomerContext): Prisma.PurchaseRequestWhereInput {
    return {
      deletedAt: null,
      customerOrgId: ctx.organizationId,
    };
  }

  private isExpired(pr: {
    responseDeadline: Date | null;
    expiresAt: Date | null;
  }) {
    return this.prState.isPastDeadline(pr);
  }

  private latestPendingRole(pr: PrWithIncludes) {
    const pending = [...(pr.counterOffers ?? [])]
      .reverse()
      .find((c) => c.status === CounterOfferStatus.PENDING);
    return pending?.createdByRole ?? null;
  }

  private toFacing(pr: PrWithIncludes) {
    const latestRole = this.latestPendingRole(pr);
    return toCustomerFacingPr(pr, {
      remainingSeconds: this.prState.remainingSeconds(
        this.prState.deadlineOf(pr),
      ),
      allowedActions: this.prState.customerAllowedActions(
        pr.status,
        latestRole,
      ),
      poNumber: pr.purchaseOrders?.[0]?.referenceNumber ?? null,
    });
  }

  private async markExpiredIfNeeded(
    pr: PrWithIncludes,
  ): Promise<PrWithIncludes> {
    if (!PENDING_STATUSES.has(pr.status) || !this.isExpired(pr)) {
      return pr;
    }
    const updated = await this.prisma.purchaseRequest.update({
      where: { id: pr.id },
      data: { status: PurchaseRequestStatus.EXPIRED },
      include: prInclude,
    });
    await this.prEvents.record(this.prisma, {
      purchaseRequestId: pr.id,
      eventType: 'PURCHASE_REQUEST_EXPIRED',
      actorRole: NegotiationActorRole.SYSTEM,
    });
    return updated;
  }

  private async createWithUniqueReference(
    tx: Prisma.TransactionClient,
    data: Omit<Prisma.PurchaseRequestUncheckedCreateInput, 'referenceNumber'>,
  ) {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        return await tx.purchaseRequest.create({
          data: {
            ...data,
            referenceNumber: nextPrReference(),
          },
          include: prInclude,
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const target =
            (err.meta?.target as string[] | string | undefined) ?? [];
          const fields = Array.isArray(target) ? target : [String(target)];
          if (fields.some((f) => String(f).includes('reference'))) {
            continue;
          }
        }
        throw err;
      }
    }
    throw new BadRequestException(
      'Unable to allocate purchase request reference',
    );
  }

  private async assertAddress(ctx: CustomerContext, addressId?: string) {
    if (!addressId) return;
    const address = await this.prisma.address.findFirst({
      where: {
        id: addressId,
        organizationId: ctx.organizationId,
        deletedAt: null,
        isActive: true,
      },
    });
    if (!address) {
      throw new MarketplaceException(
        'ADDRESS_NOT_FOUND',
        'Address not found for this customer organization',
      );
    }
  }

  async create(userId: string, dto: CreatePurchaseRequestDto) {
    const ctx = await this.ctx(userId);

    if (dto.idempotencyKey) {
      const existing = await this.prisma.purchaseRequest.findFirst({
        where: {
          ...this.scope(ctx),
          idempotencyKey: dto.idempotencyKey,
        },
        include: prInclude,
      });
      if (existing) {
        const batchKey =
          (existing.metadata as { batchKey?: string } | null)?.batchKey ??
          dto.idempotencyKey;
        const siblings = await this.prisma.purchaseRequest.findMany({
          where: {
            ...this.scope(ctx),
            OR: [
              { idempotencyKey: dto.idempotencyKey },
              {
                metadata: {
                  path: ['batchKey'],
                  equals: batchKey,
                },
              },
            ],
          },
          include: prInclude,
          orderBy: { createdAt: 'asc' },
        });
        return {
          purchaseRequests: siblings.map((pr) => this.toFacing(pr)),
          idempotent: true,
        };
      }
    }

    await this.assertAddress(ctx, dto.shippingAddressId);
    await this.assertAddress(ctx, dto.billingAddressId);

    const cart = await this.cartService.getOrCreateCart(ctx);
    const selected = dto.cartItemIds?.length
      ? cart.items.filter((i) => dto.cartItemIds!.includes(i.id))
      : cart.items;

    if (dto.cartItemIds?.length && selected.length !== dto.cartItemIds.length) {
      throw new MarketplaceException(
        'CART_ITEM_NOT_FOUND',
        'One or more cart items were not found in the cart',
      );
    }
    if (selected.length === 0) {
      throw new MarketplaceException(
        'CART_EMPTY',
        'Cart has no items to submit',
      );
    }

    const now = new Date();
    const deadline = new Date(now.getTime() + PR_RESPONSE_WINDOW_MS);
    const batchKey = dto.idempotencyKey ?? `batch-${randomUUID()}`;

    const created = await this.prisma.$transaction(async (tx) => {
      const validated: Array<{
        item: (typeof selected)[number];
        unitPrice: Prisma.Decimal | number;
        organizationId: string;
      }> = [];

      for (const item of selected) {
        const offer = await tx.offer.findFirst({
          where: { id: item.offerId, deletedAt: null },
          include: {
            ...offerInclude,
            product: {
              select: {
                id: true,
                code: true,
                name: true,
                packaging: true,
                unit: true,
                status: true,
                deletedAt: true,
              },
            },
            priceTiers: true,
          },
        });
        if (!offer) throw new MarketplaceException('OFFER_NOT_FOUND');
        const quantity = Number(item.quantity);
        assertMarketplaceOffer(offer, quantity, offer.moq);
        assertAvailability(offer.quantity, quantity);
        const unitPrice = resolveOfferUnitPrice(offer, quantity);
        validated.push({
          item,
          unitPrice,
          organizationId: offer.organizationId,
        });
      }

      const byOrg = new Map<string, typeof validated>();
      for (const row of validated) {
        const list = byOrg.get(row.organizationId) ?? [];
        list.push(row);
        byOrg.set(row.organizationId, list);
      }

      const orgEntries = [...byOrg.entries()];
      const prs: PrWithIncludes[] = [];

      for (let i = 0; i < orgEntries.length; i++) {
        const [sellerOrgId, rows] = orgEntries[i]!;
        const paymentMethod = rows[0]?.item.paymentMethod ?? null;
        const targetPrice = rows.reduce(
          (sum, r) => sum + Number(r.unitPrice) * Number(r.item.quantity),
          0,
        );

        const pr = await this.createWithUniqueReference(tx, {
          customerOrgId: ctx.organizationId,
          customerProfileId: ctx.customerProfileId,
          sellerOrgId,
          createdById: userId,
          status: PurchaseRequestStatus.SOURCING,
          paymentMethod,
          targetPrice,
          currency: rows[0]!.item.currency,
          notes: dto.notes,
          destinationRegion: dto.destinationRegion,
          shippingAddressId: dto.shippingAddressId,
          billingAddressId: dto.billingAddressId,
          submittedAt: now,
          expiresAt: deadline,
          responseDeadline: deadline,
          idempotencyKey: i === 0 ? dto.idempotencyKey : undefined,
          metadata: {
            batchKey,
            siblingIndex: i,
            siblingCount: orgEntries.length,
          },
          items: {
            create: rows.map((r) => ({
              gradeId: r.item.gradeId,
              productId: r.item.productId,
              offerId: r.item.offerId,
              quantity: r.item.quantity,
              unit: r.item.unit,
              targetUnitPrice: r.unitPrice,
              unitPriceSnapshot: r.unitPrice,
              paymentMethod: r.item.paymentMethod,
              packaging: r.item.product?.packaging ?? null,
            })),
          },
        });

        await this.prEvents.record(tx, {
          purchaseRequestId: pr.id,
          eventType: 'PURCHASE_REQUEST_CREATED',
          actorRole: NegotiationActorRole.CUSTOMER,
          actorUserId: userId,
          metadata: {
            referenceNumber: pr.referenceNumber,
            sellerOrgId,
            itemCount: pr.items.length,
          },
        });

        prs.push(pr);
      }

      await tx.cartItem.deleteMany({
        where: { id: { in: selected.map((i) => i.id) } },
      });

      return prs;
    });

    for (const pr of created) {
      await this.audit.log({
        action: 'PURCHASE_REQUEST_CREATED',
        actorUserId: userId,
        organizationId: ctx.organizationId,
        entityType: EntityOwnerType.PURCHASE_REQUEST,
        entityId: pr.id,
        newData: {
          referenceNumber: pr.referenceNumber,
          status: pr.status,
          sellerOrgId: pr.sellerOrgId,
          itemCount: pr.items.length,
        },
      });
      await this.prEvents.notifyStub({
        actorUserId: userId,
        organizationId: ctx.organizationId,
        purchaseRequestId: pr.id,
        eventType: 'PURCHASE_REQUEST_CREATED',
        message: `PR ${pr.referenceNumber} created`,
      });
    }

    return {
      purchaseRequests: created.map((pr) => this.toFacing(pr)),
      idempotent: false,
    };
  }

  async findAll(userId: string, query: CustomerPurchaseRequestQueryDto) {
    const ctx = await this.ctx(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.PurchaseRequestWhereInput = {
      ...this.scope(ctx),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search?.trim()
        ? {
            OR: [
              {
                referenceNumber: {
                  contains: query.search.trim(),
                  mode: 'insensitive',
                },
              },
              {
                destinationRegion: {
                  contains: query.search.trim(),
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.purchaseRequest.count({ where }),
      this.prisma.purchaseRequest.findMany({
        where,
        include: prInclude,
        orderBy: {
          createdAt: query.sortOrder === 'asc' ? 'asc' : 'desc',
        },
        skip,
        take,
      }),
    ]);

    const normalized = await Promise.all(
      items.map((pr) => this.markExpiredIfNeeded(pr)),
    );

    return {
      items: normalized.map((pr) => this.toFacing(pr)),
      meta: paginationMeta(page, limit, total),
    };
  }

  private async loadOwned(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    const pr = await this.prisma.purchaseRequest.findFirst({
      where: { id, ...this.scope(ctx) },
      include: prInclude,
    });
    if (!pr) throw new NotFoundException('Purchase request not found');
    return { ctx, pr: await this.markExpiredIfNeeded(pr) };
  }

  async findOne(userId: string, id: string) {
    const { pr } = await this.loadOwned(userId, id);
    return this.toFacing(pr);
  }

  async status(userId: string, id: string) {
    const { pr } = await this.loadOwned(userId, id);
    const latestRole = this.latestPendingRole(pr);
    return {
      id: pr.id,
      referenceNumber: pr.referenceNumber,
      status: pr.status,
      expiresAt: pr.expiresAt,
      responseDeadline: pr.responseDeadline ?? pr.expiresAt,
      remainingSeconds: this.prState.remainingSeconds(
        this.prState.deadlineOf(pr),
      ),
      allowedActions: this.prState.customerAllowedActions(
        pr.status,
        latestRole,
      ),
      submittedAt: pr.submittedAt,
      rejectionReason: pr.rejectionReason,
      commerciallyAcceptedAt: pr.commerciallyAcceptedAt,
      poNumber: pr.purchaseOrders?.[0]?.referenceNumber ?? null,
    };
  }

  async negotiation(userId: string, id: string) {
    await this.loadOwned(userId, id);
    const rounds = await this.negotiationService.list(id);
    return {
      purchaseRequestId: id,
      rounds: this.negotiationService.toBlindNegotiation(rounds),
    };
  }

  async cancel(userId: string, id: string) {
    const { ctx, pr } = await this.loadOwned(userId, id);
    if (TERMINAL_STATUSES.has(pr.status)) {
      throw new ProcurementException(
        'PURCHASE_REQUEST_ALREADY_RESPONDED',
        `Cannot cancel purchase request in status ${pr.status}`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.purchaseRequest.update({
        where: { id },
        data: { status: PurchaseRequestStatus.CANCELLED },
        include: prInclude,
      });
      await this.prEvents.record(tx, {
        purchaseRequestId: id,
        eventType: 'PURCHASE_REQUEST_CANCELLED',
        actorRole: NegotiationActorRole.CUSTOMER,
        actorUserId: userId,
      });
      return next;
    });

    await this.audit.log({
      action: 'PURCHASE_REQUEST_CANCELLED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PURCHASE_REQUEST,
      entityId: id,
      previousData: { status: pr.status },
      newData: { status: updated.status },
    });

    return this.toFacing(updated);
  }

  async acceptCounter(userId: string, id: string) {
    const { ctx, pr } = await this.loadOwned(userId, id);

    if (pr.status === PurchaseRequestStatus.CONVERTED_TO_ORDER) {
      return this.toFacing(pr);
    }

    if (TERMINAL_STATUSES.has(pr.status)) {
      throw new ProcurementException(
        'PURCHASE_REQUEST_ALREADY_RESPONDED',
        `Cannot accept counter-offer in status ${pr.status}`,
      );
    }

    await this.prState.assertNotExpired(pr);

    if (pr.status !== PurchaseRequestStatus.NEGOTIATION) {
      throw new ProcurementException(
        'INVALID_STATUS_TRANSITION',
        'Counter acceptance requires NEGOTIATION status',
      );
    }

    const latestPending = pr.counterOffers
      .slice()
      .reverse()
      .find((c) => c.status === CounterOfferStatus.PENDING);

    if (
      !latestPending ||
      latestPending.createdByRole !== NegotiationActorRole.SELLER
    ) {
      throw new ProcurementException(
        'COUNTER_OFFER_NOT_FOUND',
        'No pending seller counter-offer to accept',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await this.negotiationService.expireIfNeeded(tx, latestPending);
      await tx.counterOffer.update({
        where: { id: latestPending.id },
        data: {
          status: CounterOfferStatus.ACCEPTED,
          respondedAt: new Date(),
        },
      });

      await this.prEvents.record(tx, {
        purchaseRequestId: id,
        eventType: 'COUNTER_ACCEPTED',
        actorRole: NegotiationActorRole.CUSTOMER,
        actorUserId: userId,
        metadata: { counterOfferId: latestPending.id },
      });

      const commercial = await this.commercialAcceptance.acceptCommercially(
        tx,
        {
          pr,
          actorUserId: userId,
          actorRole: NegotiationActorRole.CUSTOMER,
          unitPrice: Number(latestPending.unitPrice),
          quantity: Number(latestPending.quantity),
          paymentMethod: latestPending.paymentMethod ?? pr.paymentMethod,
          negotiationRound: latestPending.roundNumber,
          currency: latestPending.currency,
        },
      );

      const refreshed = await tx.purchaseRequest.findFirstOrThrow({
        where: { id },
        include: prInclude,
      });

      return { refreshed, commercial };
    });

    await this.audit.log({
      action: 'PURCHASE_REQUEST_COUNTER_ACCEPTED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PURCHASE_REQUEST,
      entityId: id,
      previousData: { status: pr.status },
      newData: {
        status: result.refreshed.status,
        purchaseOrderId: result.commercial.purchaseOrder.id,
        poNumber: result.commercial.purchaseOrder.referenceNumber,
      },
    });

    return this.toFacing(result.refreshed);
  }

  async rejectCounter(userId: string, id: string) {
    const { ctx, pr } = await this.loadOwned(userId, id);
    if (TERMINAL_STATUSES.has(pr.status)) {
      throw new ProcurementException(
        'PURCHASE_REQUEST_ALREADY_RESPONDED',
        `Cannot reject counter-offer in status ${pr.status}`,
      );
    }

    if (pr.status !== PurchaseRequestStatus.NEGOTIATION) {
      throw new ProcurementException(
        'INVALID_STATUS_TRANSITION',
        'Counter rejection requires NEGOTIATION status',
      );
    }

    const latestPending = pr.counterOffers
      .slice()
      .reverse()
      .find((c) => c.status === CounterOfferStatus.PENDING);

    if (
      !latestPending ||
      latestPending.createdByRole !== NegotiationActorRole.SELLER
    ) {
      throw new ProcurementException(
        'COUNTER_OFFER_NOT_FOUND',
        'No pending seller counter-offer to reject',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.counterOffer.update({
        where: { id: latestPending.id },
        data: {
          status: CounterOfferStatus.REJECTED,
          respondedAt: new Date(),
        },
      });

      const next = await tx.purchaseRequest.update({
        where: { id },
        data: {
          status: PurchaseRequestStatus.REJECTED,
          rejectionReason: 'Customer rejected counter-offer',
        },
        include: prInclude,
      });

      await this.prEvents.record(tx, {
        purchaseRequestId: id,
        eventType: 'COUNTER_REJECTED',
        actorRole: NegotiationActorRole.CUSTOMER,
        actorUserId: userId,
        metadata: { counterOfferId: latestPending.id },
      });

      return next;
    });

    await this.audit.log({
      action: 'PURCHASE_REQUEST_COUNTER_REJECTED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PURCHASE_REQUEST,
      entityId: id,
      previousData: { status: pr.status },
      newData: { status: updated.status },
    });

    return this.toFacing(updated);
  }

  async counter(userId: string, id: string, dto: CustomerCounterOfferDto) {
    const { ctx, pr } = await this.loadOwned(userId, id);

    if (TERMINAL_STATUSES.has(pr.status)) {
      throw new ProcurementException('PURCHASE_REQUEST_ALREADY_RESPONDED');
    }
    await this.prState.assertNotExpired(pr);

    if (
      pr.status !== PurchaseRequestStatus.NEGOTIATION &&
      pr.status !== PurchaseRequestStatus.OFFER_RECEIVED &&
      pr.status !== PurchaseRequestStatus.SOURCING
    ) {
      throw new ProcurementException(
        'INVALID_STATUS_TRANSITION',
        'Customer counter requires an open negotiation window',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      this.prState.assertTransition(
        pr.status,
        PurchaseRequestStatus.NEGOTIATION,
      );

      const counter = await this.negotiationService.createCounter(tx, {
        purchaseRequestId: id,
        createdByRole: NegotiationActorRole.CUSTOMER,
        createdByUserId: userId,
        unitPrice: dto.unitPrice,
        quantity: dto.quantity,
        paymentMethod: dto.paymentMethod ?? pr.paymentMethod,
        currency: pr.currency,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        note: dto.note,
        supersedePrevious: true,
      });

      const next = await tx.purchaseRequest.update({
        where: { id },
        data: { status: PurchaseRequestStatus.NEGOTIATION },
        include: prInclude,
      });

      await this.prEvents.record(tx, {
        purchaseRequestId: id,
        eventType: 'CUSTOMER_COUNTER_OFFERED',
        actorRole: NegotiationActorRole.CUSTOMER,
        actorUserId: userId,
        metadata: {
          counterOfferId: counter.id,
          roundNumber: counter.roundNumber,
          unitPrice: Number(counter.unitPrice),
          quantity: Number(counter.quantity),
        },
      });

      return next;
    });

    await this.audit.log({
      action: 'PURCHASE_REQUEST_CUSTOMER_COUNTER',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PURCHASE_REQUEST,
      entityId: id,
      previousData: { status: pr.status },
      newData: { status: updated.status },
    });

    return this.toFacing(updated);
  }
}
