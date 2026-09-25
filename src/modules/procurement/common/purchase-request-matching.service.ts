import { Injectable, Logger } from '@nestjs/common';
import {
  InventoryStatus,
  NegotiationActorRole,
  OfferStatus,
  OrganizationStatus,
  OrganizationType,
  Prisma,
  ProductStatus,
  PurchaseRequestSellerMatchStatus,
  PurchaseRequestStatus,
  SellerStatus,
  VerificationStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { resolveOfferUnitPrice } from '../../customers/common/blind-marketplace.mapper.js';
import { ProcurementException } from './procurement.errors.js';
import { PrEventsService } from './pr-events.service.js';

const RESPONSE_WINDOW_MS = 15 * 60 * 1000;

export type MatchStrategy =
  | 'EXPLICIT_OFFER'
  | 'PRODUCT_BEST_PRICE'
  | 'GRADE_BEST_PRICE'
  | 'MULTI_SELLER'
  | 'BACKFILL';

export type EligibleSellerMatch = {
  offerId: string;
  organizationId: string;
  productId: string;
  gradeId: string;
  unitPrice: Prisma.Decimal;
  strategy: MatchStrategy;
  availableQty: number;
  moq: number;
};

type TxClient = Prisma.TransactionClient | PrismaService;

export type MatchPurchaseRequestInput = {
  purchaseRequestId: string;
  /** When set, only this offer/seller is considered (cart / locked quote). */
  explicitOfferId?: string | null;
  productId?: string | null;
  gradeId?: string | null;
  quantity: number;
  responseDeadline?: Date | null;
  /** Prefer fan-out to every eligible seller (marketplace). */
  multiSeller?: boolean;
  tx?: TxClient;
  actorUserId?: string | null;
};

export type MatchPurchaseRequestResult = {
  matchesCreated: number;
  matches: EligibleSellerMatch[];
  primarySellerOrgId: string | null;
};

const OPEN_MATCH_STATUSES: PurchaseRequestSellerMatchStatus[] = [
  PurchaseRequestSellerMatchStatus.MATCHED,
  PurchaseRequestSellerMatchStatus.VIEWED,
  PurchaseRequestSellerMatchStatus.COUNTER_OFFERED,
];

/**
 * Production seller matching for Purchase Requests.
 *
 * One master PurchaseRequest → zero-or-more PurchaseRequestSellerMatch rows.
 * Sellers never see each other; Admin sees all matches.
 */
@Injectable()
export class PurchaseRequestMatchingService {
  private readonly logger = new Logger(PurchaseRequestMatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prEvents: PrEventsService,
  ) {}

  async matchPurchaseRequest(
    input: MatchPurchaseRequestInput,
  ): Promise<MatchPurchaseRequestResult> {
    const db = input.tx ?? this.prisma;
    const quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { matchesCreated: 0, matches: [], primarySellerOrgId: null };
    }

    const eligible = await this.findEligibleSellers({
      offerId: input.explicitOfferId,
      productId: input.productId,
      gradeId: input.gradeId,
      quantity,
      multiSeller: input.multiSeller ?? !input.explicitOfferId,
      tx: db,
    });

    if (eligible.length === 0) {
      this.logger.warn(
        `No eligible sellers for PR ${input.purchaseRequestId} (product=${input.productId} grade=${input.gradeId})`,
      );
      return { matchesCreated: 0, matches: [], primarySellerOrgId: null };
    }

    const pr = await db.purchaseRequest.findFirst({
      where: { id: input.purchaseRequestId, deletedAt: null },
      select: {
        id: true,
        referenceNumber: true,
        sellerOrgId: true,
        responseDeadline: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    if (!pr) {
      return { matchesCreated: 0, matches: [], primarySellerOrgId: null };
    }

    const deadline =
      input.responseDeadline ??
      pr.responseDeadline ??
      pr.expiresAt ??
      new Date(Date.now() + RESPONSE_WINDOW_MS);

    const created = await this.createSellerMatches({
      tx: db,
      purchaseRequestId: pr.id,
      deadline,
      matches: eligible,
    });

    // Keep legacy sellerOrgId for PO/commercial path: primary = lowest price.
    const primary = eligible[0]!;
    if (!pr.sellerOrgId) {
      await db.purchaseRequest.update({
        where: { id: pr.id },
        data: {
          sellerOrgId: primary.organizationId,
          status: PurchaseRequestStatus.SOURCING,
          responseDeadline: deadline,
          expiresAt: pr.expiresAt ?? deadline,
        },
      });
    }

    const firstItem = await db.purchaseRequestItem.findFirst({
      where: { purchaseRequestId: pr.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, offerId: true },
    });
    if (firstItem && firstItem.offerId !== primary.offerId) {
      await db.purchaseRequestItem.update({
        where: { id: firstItem.id },
        data: {
          offerId: primary.offerId,
          productId: primary.productId,
          gradeId: primary.gradeId,
        },
      });
    }

    if (created.length > 0) {
      await this.prEvents.record(db, {
        purchaseRequestId: pr.id,
        eventType: 'SELLER_MATCHED',
        actorRole: NegotiationActorRole.SYSTEM,
        actorUserId: input.actorUserId ?? undefined,
        metadata: {
          sellerOrgIds: created.map((m) => m.organizationId),
          offerIds: created.map((m) => m.offerId),
          strategies: created.map((m) => m.strategy),
          matchCount: created.length,
          referenceNumber: pr.referenceNumber,
        },
      });

      const alreadySent = await db.purchaseRequestEvent.findFirst({
        where: {
          purchaseRequestId: pr.id,
          eventType: 'SENT_TO_SELLER',
        },
        select: { id: true },
      });
      if (!alreadySent) {
        await this.prEvents.record(db, {
          purchaseRequestId: pr.id,
          eventType: 'SENT_TO_SELLER',
          actorRole: NegotiationActorRole.SYSTEM,
          actorUserId: input.actorUserId ?? undefined,
          metadata: {
            sellerOrgIds: created.map((m) => m.organizationId),
            responseDeadline: deadline.toISOString(),
            windowMs: RESPONSE_WINDOW_MS,
            matchCount: created.length,
          },
        });
      }

      for (const match of created) {
        await this.prEvents.notifyStub({
          organizationId: match.organizationId,
          purchaseRequestId: pr.id,
          eventType: 'SENT_TO_SELLER',
          message: `New PR ${pr.referenceNumber} — respond within 15 minutes`,
        });
      }

      this.logger.log(
        `[PurchaseRequest] Matched PR ${pr.referenceNumber}: ${created.length} seller(s)`,
      );
    }

    return {
      matchesCreated: created.length,
      matches: created,
      primarySellerOrgId: primary.organizationId,
    };
  }

  async findEligibleSellers(input: {
    offerId?: string | null;
    productId?: string | null;
    gradeId?: string | null;
    quantity: number;
    multiSeller?: boolean;
    tx?: TxClient;
  }): Promise<EligibleSellerMatch[]> {
    const db = input.tx ?? this.prisma;
    const qty = input.quantity;

    if (input.offerId) {
      const single = await this.validateSellerEligibility(db, {
        offerId: input.offerId,
        quantity: qty,
        strategy: 'EXPLICIT_OFFER',
      });
      return single ? [single] : [];
    }

    const byProduct = input.productId
      ? await this.listEligibleOffers(db, { productId: input.productId }, qty)
      : [];
    const byGrade =
      byProduct.length === 0 && input.gradeId
        ? await this.listEligibleOffers(db, { gradeId: input.gradeId }, qty)
        : [];

    const pool =
      byProduct.length > 0
        ? byProduct.map((m) => ({
            ...m,
            strategy: 'PRODUCT_BEST_PRICE' as const,
          }))
        : byGrade.map((m) => ({
            ...m,
            strategy: 'GRADE_BEST_PRICE' as const,
          }));

    // Deduplicate by seller org (keep cheapest offer per seller).
    const byOrg = new Map<string, EligibleSellerMatch>();
    for (const row of pool) {
      const existing = byOrg.get(row.organizationId);
      if (!existing || Number(row.unitPrice) < Number(existing.unitPrice)) {
        byOrg.set(row.organizationId, row);
      }
    }

    const ranked = [...byOrg.values()].sort((a, b) => {
      const price = Number(a.unitPrice) - Number(b.unitPrice);
      if (price !== 0) return price;
      return b.availableQty - a.availableQty;
    });

    if (!input.multiSeller) {
      return ranked.slice(0, 1);
    }
    return ranked;
  }

  async validateSellerEligibility(
    db: TxClient,
    input: {
      offerId: string;
      quantity: number;
      strategy?: MatchStrategy;
    },
  ): Promise<EligibleSellerMatch | null> {
    const now = new Date();
    const offer = await db.offer.findFirst({
      where: {
        id: input.offerId,
        deletedAt: null,
        status: OfferStatus.ACTIVE,
        OR: [{ visibility: 'MARKETPLACE' }, { visibility: null }],
        AND: [
          { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        ],
        product: {
          deletedAt: null,
          status: ProductStatus.ACTIVE,
        },
        organization: {
          deletedAt: null,
          status: OrganizationStatus.ACTIVE,
          verificationStatus: VerificationStatus.APPROVED,
          OR: [{ type: OrganizationType.SELLER }, { type: OrganizationType.BOTH }],
          sellerProfile: {
            deletedAt: null,
            status: SellerStatus.APPROVED,
          },
        },
      },
      include: {
        priceTiers: { orderBy: { minQty: 'asc' } },
        inventory: {
          select: {
            id: true,
            availableQty: true,
            reservedQty: true,
            status: true,
            deletedAt: true,
          },
        },
      },
    });
    if (!offer) return null;

    const moq = offer.moq == null ? 0 : Number(offer.moq);
    if (input.quantity < moq) return null;

    const inventoryQty = await this.resolveSellableQty(db, offer);
    if (inventoryQty < input.quantity) return null;

    const offerQty = Number(offer.quantity);
    if (Number.isFinite(offerQty) && offerQty < input.quantity) return null;

    const unitPrice = new Prisma.Decimal(
      resolveOfferUnitPrice(offer, input.quantity),
    );

    return {
      offerId: offer.id,
      organizationId: offer.organizationId,
      productId: offer.productId,
      gradeId: offer.gradeId,
      unitPrice,
      strategy: input.strategy ?? 'EXPLICIT_OFFER',
      availableQty: inventoryQty,
      moq,
    };
  }

  /** Re-check inventory at accept/counter time (prevent overselling). */
  async assertInventorySufficient(
    db: TxClient,
    input: { offerId: string; quantity: number },
  ): Promise<void> {
    const match = await this.validateSellerEligibility(db, {
      offerId: input.offerId,
      quantity: input.quantity,
    });
    if (!match) {
      throw new ProcurementException(
        'INSUFFICIENT_AVAILABILITY',
        'Seller no longer has sufficient sellable inventory for this request',
      );
    }
  }

  async createSellerMatches(input: {
    tx: TxClient;
    purchaseRequestId: string;
    deadline: Date;
    matches: EligibleSellerMatch[];
  }): Promise<EligibleSellerMatch[]> {
    const created: EligibleSellerMatch[] = [];

    for (const match of input.matches) {
      const existing = await input.tx.purchaseRequestSellerMatch.findUnique({
        where: {
          purchaseRequestId_sellerOrgId: {
            purchaseRequestId: input.purchaseRequestId,
            sellerOrgId: match.organizationId,
          },
        },
      });

      if (existing) {
        // Do not resurrect terminal rows.
        if (
          existing.status === PurchaseRequestSellerMatchStatus.REMOVED ||
          existing.status === PurchaseRequestSellerMatchStatus.EXPIRED ||
          existing.status === PurchaseRequestSellerMatchStatus.REJECTED ||
          existing.status === PurchaseRequestSellerMatchStatus.ACCEPTED
        ) {
          continue;
        }
        await input.tx.purchaseRequestSellerMatch.update({
          where: { id: existing.id },
          data: {
            offerId: match.offerId,
            matchStrategy: match.strategy,
            sellerOfferPrice: match.unitPrice,
            sellerRequestedPrice: match.unitPrice,
            responseDeadline: input.deadline,
          },
        });
        created.push(match);
        continue;
      }

      await input.tx.purchaseRequestSellerMatch.create({
        data: {
          purchaseRequestId: input.purchaseRequestId,
          sellerOrgId: match.organizationId,
          offerId: match.offerId,
          matchStrategy: match.strategy,
          status: PurchaseRequestSellerMatchStatus.MATCHED,
          matchedAt: new Date(),
          responseDeadline: input.deadline,
          sellerOfferPrice: match.unitPrice,
          sellerRequestedPrice: match.unitPrice,
        },
      });
      created.push(match);
    }

    return created;
  }

  /** Mark this seller ACCEPTED and remove competing open matches. */
  async markSellerAccepted(
    tx: Prisma.TransactionClient,
    input: {
      purchaseRequestId: string;
      sellerOrgId: string;
      counterPrice?: number | null;
    },
  ) {
    const now = new Date();
    await tx.purchaseRequestSellerMatch.updateMany({
      where: {
        purchaseRequestId: input.purchaseRequestId,
        sellerOrgId: input.sellerOrgId,
        status: { in: OPEN_MATCH_STATUSES },
      },
      data: {
        status: PurchaseRequestSellerMatchStatus.ACCEPTED,
        respondedAt: now,
        ...(input.counterPrice != null
          ? { sellerCounterPrice: input.counterPrice }
          : {}),
      },
    });

    await tx.purchaseRequestSellerMatch.updateMany({
      where: {
        purchaseRequestId: input.purchaseRequestId,
        sellerOrgId: { not: input.sellerOrgId },
        status: { in: OPEN_MATCH_STATUSES },
      },
      data: {
        status: PurchaseRequestSellerMatchStatus.REMOVED,
        respondedAt: now,
      },
    });
  }

  async markSellerRejected(
    tx: Prisma.TransactionClient,
    input: { purchaseRequestId: string; sellerOrgId: string },
  ) {
    await tx.purchaseRequestSellerMatch.updateMany({
      where: {
        purchaseRequestId: input.purchaseRequestId,
        sellerOrgId: input.sellerOrgId,
        status: { in: OPEN_MATCH_STATUSES },
      },
      data: {
        status: PurchaseRequestSellerMatchStatus.REJECTED,
        respondedAt: new Date(),
      },
    });
  }

  async markSellerCountered(
    tx: Prisma.TransactionClient,
    input: {
      purchaseRequestId: string;
      sellerOrgId: string;
      counterPrice: number;
    },
  ) {
    await tx.purchaseRequestSellerMatch.updateMany({
      where: {
        purchaseRequestId: input.purchaseRequestId,
        sellerOrgId: input.sellerOrgId,
        status: { in: OPEN_MATCH_STATUSES },
      },
      data: {
        status: PurchaseRequestSellerMatchStatus.COUNTER_OFFERED,
        respondedAt: new Date(),
        sellerCounterPrice: input.counterPrice,
      },
    });
  }

  async markSellerViewed(
    tx: Prisma.TransactionClient | PrismaService,
    input: { purchaseRequestId: string; sellerOrgId: string },
  ) {
    await tx.purchaseRequestSellerMatch.updateMany({
      where: {
        purchaseRequestId: input.purchaseRequestId,
        sellerOrgId: input.sellerOrgId,
        status: PurchaseRequestSellerMatchStatus.MATCHED,
      },
      data: {
        status: PurchaseRequestSellerMatchStatus.VIEWED,
        viewedAt: new Date(),
      },
    });
  }

  async expireOpenMatches(
    tx: Prisma.TransactionClient | PrismaService,
    purchaseRequestId: string,
  ) {
    await tx.purchaseRequestSellerMatch.updateMany({
      where: {
        purchaseRequestId,
        status: { in: OPEN_MATCH_STATUSES },
      },
      data: { status: PurchaseRequestSellerMatchStatus.EXPIRED },
    });
  }

  private async listEligibleOffers(
    db: TxClient,
    where: { productId?: string; gradeId?: string },
    quantity: number,
  ): Promise<EligibleSellerMatch[]> {
    const now = new Date();
    const offers = await db.offer.findMany({
      where: {
        deletedAt: null,
        status: OfferStatus.ACTIVE,
        OR: [{ visibility: 'MARKETPLACE' }, { visibility: null }],
        AND: [
          { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        ],
        ...(where.productId ? { productId: where.productId } : {}),
        ...(where.gradeId ? { gradeId: where.gradeId } : {}),
        product: {
          deletedAt: null,
          status: ProductStatus.ACTIVE,
        },
        organization: {
          deletedAt: null,
          status: OrganizationStatus.ACTIVE,
          verificationStatus: VerificationStatus.APPROVED,
          OR: [{ type: OrganizationType.SELLER }, { type: OrganizationType.BOTH }],
          sellerProfile: {
            deletedAt: null,
            status: SellerStatus.APPROVED,
          },
        },
      },
      include: {
        priceTiers: { orderBy: { minQty: 'asc' } },
        inventory: {
          select: {
            id: true,
            availableQty: true,
            reservedQty: true,
            status: true,
            deletedAt: true,
          },
        },
      },
      orderBy: { basePrice: 'asc' },
      take: 100,
    });

    const eligible: EligibleSellerMatch[] = [];
    for (const offer of offers) {
      const moq = offer.moq == null ? 0 : Number(offer.moq);
      if (quantity < moq) continue;
      const offerQty = Number(offer.quantity);
      if (Number.isFinite(offerQty) && offerQty < quantity) continue;
      const inventoryQty = await this.resolveSellableQty(db, offer);
      if (inventoryQty < quantity) continue;
      eligible.push({
        offerId: offer.id,
        organizationId: offer.organizationId,
        productId: offer.productId,
        gradeId: offer.gradeId,
        unitPrice: new Prisma.Decimal(resolveOfferUnitPrice(offer, quantity)),
        strategy: 'MULTI_SELLER',
        availableQty: inventoryQty,
        moq,
      });
    }
    return eligible;
  }

  private async resolveSellableQty(
    db: TxClient,
    offer: {
      organizationId: string;
      productId: string;
      warehouseId: string | null;
      quantity: Prisma.Decimal | number;
      inventory?: {
        id: string;
        availableQty: Prisma.Decimal;
        reservedQty: Prisma.Decimal;
        status: InventoryStatus;
        deletedAt: Date | null;
      } | null;
    },
  ): Promise<number> {
    if (
      offer.inventory &&
      !offer.inventory.deletedAt &&
      (offer.inventory.status === InventoryStatus.AVAILABLE ||
        offer.inventory.status === InventoryStatus.LOW)
    ) {
      return Number(offer.inventory.availableQty);
    }

    const rows = await db.inventory.findMany({
      where: {
        deletedAt: null,
        organizationId: offer.organizationId,
        productId: offer.productId,
        status: {
          in: [InventoryStatus.AVAILABLE, InventoryStatus.LOW],
        },
        ...(offer.warehouseId ? { warehouseId: offer.warehouseId } : {}),
      },
      select: { availableQty: true },
    });

    if (rows.length > 0) {
      return rows.reduce((sum, row) => sum + Number(row.availableQty), 0);
    }

    // Fallback: offer quantity when inventory rows are not yet linked.
    return Number(offer.quantity);
  }
}
