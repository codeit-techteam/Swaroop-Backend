import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CounterOfferStatus,
  CurrencyCode,
  EntityOwnerType,
  NegotiationActorRole,
  OfferStatus,
  Prisma,
  ProductStatus,
  PurchaseRequestResponseType,
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
import { toBlindPurchaseRequest } from '../common/blind-pr.mapper.js';
import { SellerAuditService } from '../common/seller-audit.service.js';
import {
  SellerContext,
  SellerContextService,
} from '../common/seller-context.service.js';
import type {
  AcceptPurchaseRequestDto,
  CounterOfferPurchaseRequestDto,
  PurchaseRequestQueryDto,
  RejectPurchaseRequestDto,
  RespondPurchaseRequestDto,
} from './purchase-requests.dto.js';

const prInclude = {
  items: {
    include: {
      grade: {
        select: { id: true, code: true, name: true, displayName: true },
      },
      product: { select: { id: true, code: true, name: true } },
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
      organizationId: true,
      sellerProfileId: true,
    },
  },
  counterOffers: {
    orderBy: [{ roundNumber: 'desc' as const }, { createdAt: 'desc' as const }],
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
    private readonly sellerContext: SellerContextService,
    private readonly audit: SellerAuditService,
    private readonly prState: PrStateService,
    private readonly prEvents: PrEventsService,
    private readonly negotiationService: NegotiationService,
    private readonly commercialAcceptance: CommercialAcceptanceService,
  ) {}

  private async ctx(userId: string) {
    return this.sellerContext.requireSeller(userId);
  }

  private inboxWhere(ctx: SellerContext): Prisma.PurchaseRequestWhereInput {
    return {
      deletedAt: null,
      OR: [
        { sellerOrgId: ctx.organizationId },
        {
          sellerOrgId: null,
          status: {
            in: [
              PurchaseRequestStatus.SOURCING,
              PurchaseRequestStatus.SUBMITTED,
              PurchaseRequestStatus.UNDER_REVIEW,
            ],
          },
        },
      ],
    };
  }

  private latestPendingRole(pr: PrWithIncludes) {
    const pending = pr.counterOffers?.find(
      (c) => c.status === CounterOfferStatus.PENDING,
    );
    return pending?.createdByRole ?? null;
  }

  private blind(pr: PrWithIncludes) {
    const latestRole = this.latestPendingRole(pr);
    return toBlindPurchaseRequest(pr, {
      remainingSeconds: this.prState.remainingSeconds(
        this.prState.deadlineOf(pr),
      ),
      allowedActions: this.prState.sellerAllowedActions(pr.status, latestRole),
      latestCounterRole: latestRole,
    });
  }

  private async loadOwned(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    const pr = await this.prisma.purchaseRequest.findFirst({
      where: { id, deletedAt: null, AND: [this.inboxWhere(ctx)] },
      include: prInclude,
    });
    if (!pr) throw new NotFoundException('Purchase request not found');
    return { ctx, pr };
  }

  private assertNotTerminalAlreadyResponded(status: PurchaseRequestStatus) {
    if (this.prState.isTerminal(status)) {
      throw new ProcurementException(
        'PURCHASE_REQUEST_ALREADY_RESPONDED',
        `Purchase request is already in terminal status ${status}`,
      );
    }
  }

  private async revalidateOfferTerms(
    tx: Prisma.TransactionClient,
    pr: PrWithIncludes,
    quantity: number,
  ) {
    const item = pr.items[0];
    if (!item?.offerId) return;

    const offer = await tx.offer.findFirst({
      where: { id: item.offerId, deletedAt: null },
      include: {
        product: {
          select: { status: true, deletedAt: true },
        },
      },
    });
    if (!offer) {
      throw new ProcurementException(
        'PRODUCT_UNAVAILABLE',
        'Linked offer not found',
      );
    }
    if (offer.status !== OfferStatus.ACTIVE) {
      throw new ProcurementException(
        'OFFER_EXPIRED',
        'Offer is no longer active',
      );
    }
    if (offer.validUntil && offer.validUntil < new Date()) {
      throw new ProcurementException('OFFER_EXPIRED');
    }
    if (
      !offer.product ||
      offer.product.deletedAt ||
      offer.product.status !== ProductStatus.ACTIVE
    ) {
      throw new ProcurementException('PRODUCT_UNAVAILABLE');
    }
    const moq = offer.moq == null ? 0 : Number(offer.moq);
    if (quantity < moq) {
      throw new ProcurementException('MOQ_NOT_MET');
    }
    const available = Number(offer.quantity);
    if (Number.isFinite(available) && quantity > available) {
      throw new ProcurementException('INSUFFICIENT_AVAILABILITY');
    }
  }

  async findAll(userId: string, query: PurchaseRequestQueryDto) {
    const ctx = await this.ctx(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.PurchaseRequestWhereInput = {
      AND: [
        this.inboxWhere(ctx),
        query.status ? { status: query.status } : {},
        query.search?.trim()
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
          : {},
      ],
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.purchaseRequest.count({ where }),
      this.prisma.purchaseRequest.findMany({
        where,
        include: prInclude,
        orderBy: [
          { sellerOrgId: 'desc' },
          { createdAt: query.sortOrder === 'asc' ? 'asc' : 'desc' },
        ],
        skip,
        take,
      }),
    ]);

    return {
      items: items.map((pr) => this.blind(pr)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(userId: string, id: string) {
    const { ctx, pr } = await this.loadOwned(userId, id);

    let viewed = pr;
    if (!pr.viewedBySellerAt) {
      viewed = await this.prisma.purchaseRequest.update({
        where: { id },
        data: { viewedBySellerAt: new Date() },
        include: prInclude,
      });
      await this.prEvents.record(this.prisma, {
        purchaseRequestId: id,
        eventType: 'PURCHASE_REQUEST_VIEWED_BY_SELLER',
        actorRole: NegotiationActorRole.SELLER,
        actorUserId: userId,
      });
      await this.audit.log({
        action: 'PR_VIEWED',
        actorUserId: userId,
        organizationId: ctx.organizationId,
        entityType: EntityOwnerType.PURCHASE_REQUEST,
        entityId: id,
      });
    }

    return this.blind(viewed);
  }

  async status(userId: string, id: string) {
    const { pr } = await this.loadOwned(userId, id);
    const latestRole = this.latestPendingRole(pr);
    const deadline = this.prState.deadlineOf(pr);
    return {
      id: pr.id,
      referenceNumber: pr.referenceNumber,
      status: pr.status,
      responseDeadline: deadline,
      remainingSeconds: this.prState.remainingSeconds(deadline),
      allowedActions: this.prState.sellerAllowedActions(pr.status, latestRole),
      purchaseOrder: pr.purchaseOrders?.[0]
        ? {
            referenceNumber: pr.purchaseOrders[0].referenceNumber,
            status: pr.purchaseOrders[0].status,
          }
        : null,
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

  async expire(userId: string, id: string) {
    const { ctx, pr } = await this.loadOwned(userId, id);
    if (!this.prState.isPastDeadline(pr)) {
      throw new BadRequestException({
        code: 'INVALID_STATUS_TRANSITION',
        message: 'Response deadline has not passed yet',
      });
    }
    if (this.prState.isTerminal(pr.status)) {
      return this.blind(pr);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.purchaseRequest.update({
        where: { id },
        data: { status: PurchaseRequestStatus.EXPIRED },
        include: prInclude,
      });
      await this.prEvents.record(tx, {
        purchaseRequestId: id,
        eventType: 'PURCHASE_REQUEST_EXPIRED',
        actorRole: NegotiationActorRole.SELLER,
        actorUserId: userId,
      });
      return next;
    });

    await this.audit.log({
      action: 'PR_EXPIRED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PURCHASE_REQUEST,
      entityId: id,
    });

    return this.blind(updated);
  }

  async accept(userId: string, id: string, dto: AcceptPurchaseRequestDto) {
    return this.respond(userId, id, {
      type: PurchaseRequestResponseType.ACCEPT,
      message: dto.message,
      metadata: dto.metadata,
    });
  }

  async reject(userId: string, id: string, dto: RejectPurchaseRequestDto) {
    return this.respond(userId, id, {
      type: PurchaseRequestResponseType.REJECT,
      message: dto.message,
      rejectionReason: dto.rejectionReason,
    });
  }

  async counterOffer(
    userId: string,
    id: string,
    dto: CounterOfferPurchaseRequestDto,
  ) {
    const counterPrice = dto.counterPrice ?? dto.unitPrice;
    const counterQuantity = dto.counterQuantity ?? dto.quantity;
    if (counterPrice == null) {
      throw new BadRequestException('counterPrice (or unitPrice) is required');
    }
    return this.respond(userId, id, {
      type: PurchaseRequestResponseType.COUNTER_OFFER,
      message: dto.message ?? dto.note,
      counterPrice,
      counterQuantity,
      currency: dto.currency,
      paymentMethod: dto.paymentMethod,
      validUntil: dto.validUntil,
      metadata: dto.metadata,
    });
  }

  async respond(userId: string, id: string, dto: RespondPurchaseRequestDto) {
    const { ctx, pr } = await this.loadOwned(userId, id);

    if (
      pr.status === PurchaseRequestStatus.CONVERTED_TO_ORDER ||
      pr.status === PurchaseRequestStatus.APPROVED
    ) {
      if (dto.type === PurchaseRequestResponseType.ACCEPT) {
        const po = pr.purchaseOrders?.[0];
        return {
          purchaseRequest: this.blind(pr),
          response: null,
          revision: null,
          purchaseOrder: po
            ? {
                id: po.id,
                referenceNumber: po.referenceNumber,
                status: po.status,
              }
            : null,
          idempotent: true,
        };
      }
      throw new ProcurementException('PURCHASE_REQUEST_ALREADY_RESPONDED');
    }

    this.assertNotTerminalAlreadyResponded(pr.status);
    await this.prState.assertNotExpired(pr);

    if (
      dto.type === PurchaseRequestResponseType.REJECT &&
      !dto.rejectionReason
    ) {
      throw new BadRequestException('rejectionReason is required for REJECT');
    }
    if (
      dto.type === PurchaseRequestResponseType.COUNTER_OFFER &&
      dto.counterPrice == null
    ) {
      throw new BadRequestException(
        'counterPrice is required for COUNTER_OFFER',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.purchaseRequest.findFirst({
        where: { id, deletedAt: null },
        include: prInclude,
      });
      if (!locked) throw new NotFoundException('Purchase request not found');

      if (
        locked.status === PurchaseRequestStatus.CONVERTED_TO_ORDER ||
        locked.status === PurchaseRequestStatus.APPROVED
      ) {
        if (dto.type === PurchaseRequestResponseType.ACCEPT) {
          const po = locked.purchaseOrders?.[0];
          return {
            updated: locked,
            response: null,
            revision: null,
            purchaseOrder: po ?? null,
            idempotent: true,
          };
        }
        throw new ProcurementException('PURCHASE_REQUEST_ALREADY_RESPONDED');
      }

      this.assertNotTerminalAlreadyResponded(locked.status);
      if (this.prState.isPastDeadline(locked)) {
        await tx.purchaseRequest.update({
          where: { id },
          data: { status: PurchaseRequestStatus.EXPIRED },
        });
        await this.prEvents.record(tx, {
          purchaseRequestId: id,
          eventType: 'PURCHASE_REQUEST_EXPIRED',
          actorRole: NegotiationActorRole.SYSTEM,
        });
        throw new ProcurementException('PURCHASE_REQUEST_EXPIRED');
      }

      const latestPending = locked.counterOffers.find(
        (c) => c.status === CounterOfferStatus.PENDING,
      );

      if (dto.type === PurchaseRequestResponseType.ACCEPT) {
        const acceptFromSourcing =
          locked.status === PurchaseRequestStatus.SOURCING ||
          locked.status === PurchaseRequestStatus.OFFER_RECEIVED ||
          locked.status === PurchaseRequestStatus.SUBMITTED ||
          locked.status === PurchaseRequestStatus.UNDER_REVIEW;
        const acceptFromNegotiation =
          locked.status === PurchaseRequestStatus.NEGOTIATION &&
          latestPending?.createdByRole === NegotiationActorRole.CUSTOMER;

        if (!acceptFromSourcing && !acceptFromNegotiation) {
          throw new ProcurementException(
            'INVALID_STATUS_TRANSITION',
            'Seller can only accept from SOURCING or when a customer counter is pending',
          );
        }

        let unitPrice: number;
        let quantity: number;
        let paymentMethod = locked.paymentMethod;
        let negotiationRound: number | null = null;

        if (acceptFromNegotiation && latestPending) {
          await this.negotiationService.expireIfNeeded(tx, latestPending);
          unitPrice = Number(latestPending.unitPrice);
          quantity = Number(latestPending.quantity);
          paymentMethod = latestPending.paymentMethod ?? paymentMethod;
          negotiationRound = latestPending.roundNumber;
          await tx.counterOffer.update({
            where: { id: latestPending.id },
            data: {
              status: CounterOfferStatus.ACCEPTED,
              respondedAt: new Date(),
            },
          });
        } else {
          const item = locked.items[0];
          if (!item) {
            throw new ProcurementException(
              'INVALID_COUNTER_OFFER',
              'Purchase request has no items',
            );
          }
          unitPrice = Number(
            item.unitPriceSnapshot ?? item.targetUnitPrice ?? 0,
          );
          quantity = Number(item.quantity);
          paymentMethod = item.paymentMethod ?? paymentMethod;
        }

        await this.revalidateOfferTerms(tx, locked, quantity);

        const response = await tx.purchaseRequestResponse.create({
          data: {
            purchaseRequestId: id,
            sellerProfileId: ctx.sellerProfileId,
            organizationId: ctx.organizationId,
            type: PurchaseRequestResponseType.ACCEPT,
            message: dto.message,
            currency: locked.currency ?? CurrencyCode.INR,
            metadata: dto.metadata as Prisma.InputJsonValue,
            createdById: userId,
          },
        });

        const assigned = await tx.purchaseRequest.update({
          where: { id },
          data: {
            sellerOrgId: locked.sellerOrgId ?? ctx.organizationId,
            viewedBySellerAt: locked.viewedBySellerAt ?? new Date(),
            sellerRespondedAt: new Date(),
          },
          include: prInclude,
        });

        await this.prEvents.record(tx, {
          purchaseRequestId: id,
          eventType: 'SELLER_ACCEPTED',
          actorRole: NegotiationActorRole.SELLER,
          actorUserId: userId,
        });

        const commercial = await this.commercialAcceptance.acceptCommercially(
          tx,
          {
            pr: assigned,
            actorUserId: userId,
            actorRole: NegotiationActorRole.SELLER,
            unitPrice,
            quantity,
            paymentMethod,
            negotiationRound,
            currency: locked.currency,
          },
        );

        const refreshed = await tx.purchaseRequest.findFirstOrThrow({
          where: { id },
          include: prInclude,
        });

        return {
          updated: refreshed,
          response,
          revision: null,
          purchaseOrder: commercial.purchaseOrder,
          idempotent: commercial.idempotent,
        };
      }

      if (dto.type === PurchaseRequestResponseType.REJECT) {
        if (
          locked.status !== PurchaseRequestStatus.SOURCING &&
          locked.status !== PurchaseRequestStatus.NEGOTIATION &&
          locked.status !== PurchaseRequestStatus.OFFER_RECEIVED &&
          locked.status !== PurchaseRequestStatus.SUBMITTED &&
          locked.status !== PurchaseRequestStatus.UNDER_REVIEW
        ) {
          throw new ProcurementException('INVALID_STATUS_TRANSITION');
        }

        this.prState.assertTransition(
          locked.status,
          PurchaseRequestStatus.REJECTED,
        );

        if (latestPending) {
          await tx.counterOffer.update({
            where: { id: latestPending.id },
            data: {
              status: CounterOfferStatus.REJECTED,
              respondedAt: new Date(),
            },
          });
        }

        const response = await tx.purchaseRequestResponse.create({
          data: {
            purchaseRequestId: id,
            sellerProfileId: ctx.sellerProfileId,
            organizationId: ctx.organizationId,
            type: PurchaseRequestResponseType.REJECT,
            message: dto.message,
            currency: locked.currency ?? CurrencyCode.INR,
            metadata: dto.metadata as Prisma.InputJsonValue,
            createdById: userId,
          },
        });

        const updated = await tx.purchaseRequest.update({
          where: { id },
          data: {
            status: PurchaseRequestStatus.REJECTED,
            rejectionReason: dto.rejectionReason!,
            sellerOrgId: locked.sellerOrgId ?? ctx.organizationId,
            viewedBySellerAt: locked.viewedBySellerAt ?? new Date(),
            sellerRespondedAt: new Date(),
          },
          include: prInclude,
        });

        await this.prEvents.record(tx, {
          purchaseRequestId: id,
          eventType: 'SELLER_REJECTED',
          actorRole: NegotiationActorRole.SELLER,
          actorUserId: userId,
          metadata: { rejectionReason: dto.rejectionReason },
        });

        return {
          updated,
          response,
          revision: null,
          purchaseOrder: null,
          idempotent: false,
        };
      }

      if (dto.type === PurchaseRequestResponseType.COUNTER_OFFER) {
        this.prState.assertTransition(
          locked.status,
          PurchaseRequestStatus.NEGOTIATION,
        );

        const item = locked.items[0];
        const quantity =
          dto.counterQuantity ?? (item ? Number(item.quantity) : undefined);
        if (quantity == null) {
          throw new ProcurementException(
            'INVALID_COUNTER_OFFER',
            'counterQuantity is required when PR has no items',
          );
        }

        const response = await tx.purchaseRequestResponse.create({
          data: {
            purchaseRequestId: id,
            sellerProfileId: ctx.sellerProfileId,
            organizationId: ctx.organizationId,
            type: PurchaseRequestResponseType.COUNTER_OFFER,
            message: dto.message,
            counterPrice: dto.counterPrice!,
            counterQuantity: quantity,
            currency: dto.currency ?? locked.currency ?? CurrencyCode.INR,
            validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
            metadata: dto.metadata as Prisma.InputJsonValue,
            createdById: userId,
          },
        });

        const counter = await this.negotiationService.createCounter(tx, {
          purchaseRequestId: id,
          createdByRole: NegotiationActorRole.SELLER,
          createdByUserId: userId,
          sellerProfileId: ctx.sellerProfileId,
          unitPrice: dto.counterPrice!,
          quantity,
          paymentMethod: dto.paymentMethod ?? locked.paymentMethod,
          currency: dto.currency ?? locked.currency ?? CurrencyCode.INR,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
          note: dto.message,
          supersedePrevious: true,
        });

        const revision = await tx.priceRevision.create({
          data: {
            purchaseRequestId: id,
            previousPrice: locked.targetPrice ?? 0,
            proposedPrice: dto.counterPrice!,
            currency: dto.currency ?? locked.currency ?? CurrencyCode.INR,
            reason: dto.message ?? 'Seller counter-offer',
            status: 'PENDING',
            metadata: {
              responseId: response.id,
              counterOfferId: counter.id,
              counterQuantity: quantity,
            } as Prisma.InputJsonValue,
          },
        });

        const updated = await tx.purchaseRequest.update({
          where: { id },
          data: {
            status: PurchaseRequestStatus.NEGOTIATION,
            sellerOrgId: locked.sellerOrgId ?? ctx.organizationId,
            viewedBySellerAt: locked.viewedBySellerAt ?? new Date(),
            sellerRespondedAt: new Date(),
          },
          include: prInclude,
        });

        await this.prEvents.record(tx, {
          purchaseRequestId: id,
          eventType: 'SELLER_COUNTER_OFFERED',
          actorRole: NegotiationActorRole.SELLER,
          actorUserId: userId,
          metadata: {
            counterOfferId: counter.id,
            roundNumber: counter.roundNumber,
            unitPrice: Number(counter.unitPrice),
            quantity: Number(counter.quantity),
          },
        });

        return {
          updated,
          response,
          revision,
          purchaseOrder: null,
          idempotent: false,
        };
      }

      // RESPOND — soft acknowledge → OFFER_RECEIVED (no PO)
      this.prState.assertTransition(
        locked.status,
        PurchaseRequestStatus.OFFER_RECEIVED,
      );

      const response = await tx.purchaseRequestResponse.create({
        data: {
          purchaseRequestId: id,
          sellerProfileId: ctx.sellerProfileId,
          organizationId: ctx.organizationId,
          type: PurchaseRequestResponseType.RESPOND,
          message: dto.message,
          currency: locked.currency ?? CurrencyCode.INR,
          metadata: dto.metadata as Prisma.InputJsonValue,
          createdById: userId,
        },
      });

      const updated = await tx.purchaseRequest.update({
        where: { id },
        data: {
          status: PurchaseRequestStatus.OFFER_RECEIVED,
          sellerOrgId: locked.sellerOrgId ?? ctx.organizationId,
          viewedBySellerAt: locked.viewedBySellerAt ?? new Date(),
        },
        include: prInclude,
      });

      return {
        updated,
        response,
        revision: null,
        purchaseOrder: null,
        idempotent: false,
      };
    });

    const auditAction =
      dto.type === PurchaseRequestResponseType.ACCEPT
        ? 'PR_ACCEPTED'
        : dto.type === PurchaseRequestResponseType.REJECT
          ? 'PR_REJECTED'
          : dto.type === PurchaseRequestResponseType.COUNTER_OFFER
            ? 'PR_COUNTER_OFFERED'
            : 'PR_RESPONDED';

    await this.audit.log({
      action: auditAction,
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PURCHASE_REQUEST,
      entityId: id,
      previousData: { status: pr.status },
      newData: {
        status: result.updated.status,
        responseType: dto.type,
        responseId: result.response?.id,
        purchaseOrderId: result.purchaseOrder?.id,
      },
    });

    return {
      purchaseRequest: this.blind(result.updated),
      response: result.response,
      revision: result.revision,
      purchaseOrder: result.purchaseOrder
        ? {
            id: result.purchaseOrder.id,
            referenceNumber: result.purchaseOrder.referenceNumber,
            status: result.purchaseOrder.status,
          }
        : null,
      idempotent: result.idempotent,
    };
  }
}
