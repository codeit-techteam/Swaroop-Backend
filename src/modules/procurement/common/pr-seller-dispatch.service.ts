import { Injectable, Logger } from '@nestjs/common';
import {
  NegotiationActorRole,
  PurchaseRequestStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { PrEventsService } from './pr-events.service.js';
import { PurchaseRequestMatchingService } from './purchase-request-matching.service.js';

const DISPATCH_BATCH_SIZE = 50;
const RESPONSE_WINDOW_MS = 15 * 60 * 1000;

const UNASSIGNED_STATUSES: PurchaseRequestStatus[] = [
  PurchaseRequestStatus.SOURCING,
  PurchaseRequestStatus.SUBMITTED,
  PurchaseRequestStatus.UNDER_REVIEW,
];

export type SellerDispatchResult = {
  assigned: number;
  repairedNotifications: number;
};

/**
 * Background seller-finding: match open PRs to all eligible seller orgs that
 * own active marketplace offers for the requested product/grade, then route
 * them into each seller's blind inbox within the 15-minute response window.
 *
 * Creates PurchaseRequestSellerMatch rows (multi-seller) while keeping
 * PurchaseRequest.sellerOrgId as the primary (best-price) assignee for
 * legacy commercial/PO flows until a seller accepts.
 */
@Injectable()
export class PrSellerDispatchService {
  private readonly logger = new Logger(PrSellerDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: PurchaseRequestMatchingService,
    private readonly prEvents: PrEventsService,
  ) {}

  async dispatchPending(): Promise<SellerDispatchResult> {
    const [assigned, repairedNotifications] = await Promise.all([
      this.assignUnmatchedPurchaseRequests(),
      this.repairMissingDispatchEvents(),
    ]);

    if (assigned > 0 || repairedNotifications > 0) {
      this.logger.log(
        `Seller dispatch: assigned=${assigned} repairedNotifications=${repairedNotifications}`,
      );
    }

    return { assigned, repairedNotifications };
  }

  /**
   * Match PRs that still lack seller match rows (or sellerOrgId).
   * Prefer explicit offer → product offers → grade offers (multi-seller).
   */
  async assignUnmatchedPurchaseRequests(): Promise<number> {
    const now = new Date();
    const candidates = await this.prisma.purchaseRequest.findMany({
      where: {
        deletedAt: null,
        status: { in: UNASSIGNED_STATUSES },
        AND: [
          {
            OR: [
              { responseDeadline: { gt: now } },
              {
                AND: [
                  { responseDeadline: null },
                  { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
                ],
              },
            ],
          },
          {
            OR: [{ sellerOrgId: null }, { sellerMatches: { none: {} } }],
          },
        ],
      },
      include: {
        items: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: {
            id: true,
            offerId: true,
            productId: true,
            gradeId: true,
            quantity: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: DISPATCH_BATCH_SIZE,
    });

    let assigned = 0;
    for (const pr of candidates) {
      const item = pr.items[0];
      if (!item) continue;

      const deadline =
        pr.responseDeadline ??
        pr.expiresAt ??
        new Date(now.getTime() + RESPONSE_WINDOW_MS);

      const result = await this.matching.matchPurchaseRequest({
        purchaseRequestId: pr.id,
        explicitOfferId: item.offerId,
        productId: item.productId,
        gradeId: item.gradeId,
        quantity: Number(item.quantity),
        responseDeadline: deadline,
        // Explicit cart/quote offer → single seller; otherwise fan-out.
        multiSeller: !item.offerId,
      });

      if (result.matchesCreated > 0) {
        assigned += 1;
      } else {
        this.logger.warn(
          `No seller match for PR ${pr.referenceNumber} (product=${item.productId} grade=${item.gradeId})`,
        );
      }
    }

    return assigned;
  }

  /**
   * Ensure assigned PRs always have SENT_TO_SELLER (idempotent repair).
   */
  async repairMissingDispatchEvents(): Promise<number> {
    const now = new Date();
    const candidates = await this.prisma.purchaseRequest.findMany({
      where: {
        deletedAt: null,
        sellerOrgId: { not: null },
        status: { in: UNASSIGNED_STATUSES },
        OR: [
          { responseDeadline: { gt: now } },
          {
            AND: [
              { responseDeadline: null },
              { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            ],
          },
        ],
        events: { none: { eventType: 'SENT_TO_SELLER' } },
      },
      select: {
        id: true,
        sellerOrgId: true,
        responseDeadline: true,
        expiresAt: true,
        createdAt: true,
        referenceNumber: true,
        sellerMatches: {
          select: { sellerOrgId: true },
        },
      },
      take: DISPATCH_BATCH_SIZE,
    });

    let repaired = 0;
    for (const pr of candidates) {
      if (!pr.sellerOrgId) continue;
      const deadline =
        pr.responseDeadline ??
        pr.expiresAt ??
        new Date(pr.createdAt.getTime() + RESPONSE_WINDOW_MS);

      const sellerOrgIds =
        pr.sellerMatches.length > 0
          ? pr.sellerMatches.map((m) => m.sellerOrgId)
          : [pr.sellerOrgId];

      await this.prEvents.record(this.prisma, {
        purchaseRequestId: pr.id,
        eventType: 'SENT_TO_SELLER',
        actorRole: NegotiationActorRole.SYSTEM,
        metadata: {
          sellerOrgId: pr.sellerOrgId,
          sellerOrgIds,
          responseDeadline: deadline.toISOString(),
          windowMs: RESPONSE_WINDOW_MS,
          source: 'dispatch_repair',
        },
      });

      for (const sellerOrgId of sellerOrgIds) {
        await this.prEvents.notifyStub({
          organizationId: sellerOrgId,
          purchaseRequestId: pr.id,
          eventType: 'SENT_TO_SELLER',
          message: `New PR ${pr.referenceNumber} — respond within 15 minutes`,
        });
      }
      repaired += 1;
    }
    return repaired;
  }
}
