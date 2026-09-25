import { Injectable, Logger } from '@nestjs/common';
import {
  CounterOfferStatus,
  NegotiationActorRole,
  PurchaseRequestSellerMatchStatus,
  PurchaseRequestStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { PrEventsService } from './pr-events.service.js';

/** Statuses that auto-expire when the 15-minute seller response window elapses. */
export const SOURCING_PENDING_STATUSES: PurchaseRequestStatus[] = [
  PurchaseRequestStatus.SOURCING,
  PurchaseRequestStatus.SUBMITTED,
  PurchaseRequestStatus.UNDER_REVIEW,
  PurchaseRequestStatus.NEGOTIATION,
  PurchaseRequestStatus.OFFER_RECEIVED,
  PurchaseRequestStatus.PENDING_APPROVAL,
];

const EXPIRY_BATCH_SIZE = 100;
/** Notify once when ≤5 minutes remain in the seller response window. */
const RESPONSE_WARNING_MS = 5 * 60 * 1000;

export type SourcingSweepResult = {
  expiredPurchaseRequests: number;
  expiredCounterOffers: number;
  warnedPurchaseRequests: number;
  sellersAssigned?: number;
  dispatchRepaired?: number;
};

/**
 * Production lifecycle for the 15-minute seller-finding / negotiation window:
 * - bulk-expire past-deadline PRs (independent of lazy read-path expiry)
 * - expire stale pending counter-offers
 * - emit one-shot approaching-deadline warnings
 */
@Injectable()
export class PrSourcingLifecycleService {
  private readonly logger = new Logger(PrSourcingLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prEvents: PrEventsService,
  ) {}

  async sweep(): Promise<SourcingSweepResult> {
    const [expiredPurchaseRequests, expiredCounterOffers, warnedPurchaseRequests] =
      await Promise.all([
        this.expireDuePurchaseRequests(),
        this.expireDueCounterOffers(),
        this.warnApproachingDeadlines(),
      ]);

    if (
      expiredPurchaseRequests > 0 ||
      expiredCounterOffers > 0 ||
      warnedPurchaseRequests > 0
    ) {
      this.logger.log(
        `Sourcing sweep: expiredPRs=${expiredPurchaseRequests} expiredCounters=${expiredCounterOffers} warnings=${warnedPurchaseRequests}`,
      );
    }

    return {
      expiredPurchaseRequests,
      expiredCounterOffers,
      warnedPurchaseRequests,
    };
  }

  /**
   * Mark pending PRs past responseDeadline/expiresAt as EXPIRED.
   * Uses updateMany per row so concurrent seller accept/reject wins cleanly.
   */
  async expireDuePurchaseRequests(): Promise<number> {
    const now = new Date();
    const due = await this.prisma.purchaseRequest.findMany({
      where: {
        deletedAt: null,
        status: { in: SOURCING_PENDING_STATUSES },
        OR: [
          { responseDeadline: { lt: now } },
          {
            AND: [
              { responseDeadline: null },
              { expiresAt: { lt: now } },
            ],
          },
        ],
      },
      select: {
        id: true,
        referenceNumber: true,
        customerOrgId: true,
        sellerOrgId: true,
        createdById: true,
      },
      orderBy: { responseDeadline: 'asc' },
      take: EXPIRY_BATCH_SIZE,
    });

    let expired = 0;
    for (const pr of due) {
      const result = await this.prisma.purchaseRequest.updateMany({
        where: {
          id: pr.id,
          status: { in: SOURCING_PENDING_STATUSES },
        },
        data: { status: PurchaseRequestStatus.EXPIRED },
      });
      if (result.count === 0) continue;

      expired += 1;
      await this.prEvents.record(this.prisma, {
        purchaseRequestId: pr.id,
        eventType: 'PURCHASE_REQUEST_EXPIRED',
        actorRole: NegotiationActorRole.SYSTEM,
        metadata: {
          source: 'sourcing_lifecycle_sweep',
          referenceNumber: pr.referenceNumber,
          sellerOrgId: pr.sellerOrgId,
        },
      });
      await this.prisma.purchaseRequestSellerMatch.updateMany({
        where: {
          purchaseRequestId: pr.id,
          status: {
            in: [
              PurchaseRequestSellerMatchStatus.MATCHED,
              PurchaseRequestSellerMatchStatus.VIEWED,
              PurchaseRequestSellerMatchStatus.COUNTER_OFFERED,
            ],
          },
        },
        data: { status: PurchaseRequestSellerMatchStatus.EXPIRED },
      });
      await this.prEvents.notifyStub({
        actorUserId: pr.createdById,
        organizationId: pr.customerOrgId,
        purchaseRequestId: pr.id,
        eventType: 'PURCHASE_REQUEST_EXPIRED',
        message: `PR ${pr.referenceNumber} expired — seller did not respond within the 15-minute window`,
      });
      if (pr.sellerOrgId) {
        await this.prEvents.notifyStub({
          organizationId: pr.sellerOrgId,
          purchaseRequestId: pr.id,
          eventType: 'PURCHASE_REQUEST_EXPIRED',
          message: `PR ${pr.referenceNumber} expired in your inbox`,
        });
      }
    }

    return expired;
  }

  async expireDueCounterOffers(): Promise<number> {
    const now = new Date();
    const result = await this.prisma.counterOffer.updateMany({
      where: {
        status: CounterOfferStatus.PENDING,
        validUntil: { lt: now },
      },
      data: {
        status: CounterOfferStatus.EXPIRED,
        respondedAt: now,
      },
    });
    return result.count;
  }

  /**
   * One-shot warning when ≤5 minutes remain and seller has not responded.
   * Deduped via RESPONSE_WINDOW_WARNING event on the PR timeline.
   */
  async warnApproachingDeadlines(): Promise<number> {
    const now = new Date();
    const warnBefore = new Date(now.getTime() + RESPONSE_WARNING_MS);

    const candidates = await this.prisma.purchaseRequest.findMany({
      where: {
        deletedAt: null,
        status: {
          in: [
            PurchaseRequestStatus.SOURCING,
            PurchaseRequestStatus.SUBMITTED,
            PurchaseRequestStatus.UNDER_REVIEW,
            PurchaseRequestStatus.OFFER_RECEIVED,
          ],
        },
        sellerRespondedAt: null,
        OR: [
          {
            responseDeadline: {
              gt: now,
              lte: warnBefore,
            },
          },
          {
            AND: [
              { responseDeadline: null },
              {
                expiresAt: {
                  gt: now,
                  lte: warnBefore,
                },
              },
            ],
          },
        ],
        events: {
          none: { eventType: 'RESPONSE_WINDOW_WARNING' },
        },
      },
      select: {
        id: true,
        referenceNumber: true,
        customerOrgId: true,
        sellerOrgId: true,
        createdById: true,
        responseDeadline: true,
        expiresAt: true,
      },
      take: EXPIRY_BATCH_SIZE,
    });

    let warned = 0;
    for (const pr of candidates) {
      const deadline = pr.responseDeadline ?? pr.expiresAt;
      await this.prEvents.record(this.prisma, {
        purchaseRequestId: pr.id,
        eventType: 'RESPONSE_WINDOW_WARNING',
        actorRole: NegotiationActorRole.SYSTEM,
        metadata: {
          referenceNumber: pr.referenceNumber,
          responseDeadline: deadline?.toISOString() ?? null,
          remainingMs: deadline ? deadline.getTime() - now.getTime() : null,
        },
      });
      await this.prEvents.notifyStub({
        actorUserId: pr.createdById,
        organizationId: pr.customerOrgId,
        purchaseRequestId: pr.id,
        eventType: 'RESPONSE_WINDOW_WARNING',
        message: `PR ${pr.referenceNumber}: less than 5 minutes left for seller response`,
      });
      if (pr.sellerOrgId) {
        await this.prEvents.notifyStub({
          organizationId: pr.sellerOrgId,
          purchaseRequestId: pr.id,
          eventType: 'RESPONSE_WINDOW_WARNING',
          message: `PR ${pr.referenceNumber}: respond within 5 minutes or it will expire`,
        });
      }
      warned += 1;
    }

    return warned;
  }

  /**
   * Record SENT_TO_SELLER when a matched seller org is assigned (seller finding complete).
   * Idempotent — skips if the event already exists.
   */
  async markDispatchedToSeller(input: {
    purchaseRequestId: string;
    sellerOrgId: string;
    responseDeadline: Date;
    actorUserId?: string | null;
  }): Promise<void> {
    const existing = await this.prisma.purchaseRequestEvent.findFirst({
      where: {
        purchaseRequestId: input.purchaseRequestId,
        eventType: 'SENT_TO_SELLER',
      },
      select: { id: true },
    });
    if (existing) return;

    await this.prEvents.record(this.prisma, {
      purchaseRequestId: input.purchaseRequestId,
      eventType: 'SENT_TO_SELLER',
      actorRole: NegotiationActorRole.SYSTEM,
      actorUserId: input.actorUserId ?? undefined,
      metadata: {
        sellerOrgId: input.sellerOrgId,
        responseDeadline: input.responseDeadline.toISOString(),
        windowMs: 15 * 60 * 1000,
      },
    });
    await this.prEvents.notifyStub({
      organizationId: input.sellerOrgId,
      purchaseRequestId: input.purchaseRequestId,
      eventType: 'SENT_TO_SELLER',
      message: 'New purchase request awaiting response (15-minute window)',
    });
  }
}
