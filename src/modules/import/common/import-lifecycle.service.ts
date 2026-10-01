import { Injectable } from '@nestjs/common';
import {
  EntityOwnerType,
  ImportListingStatus,
  ImportMatchStatus,
  ImportNegotiationEventType,
  ImportNegotiationStatus,
  ImportSide,
  ImportTradeParty,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { IMPORT_NOTIFICATION_EVENTS } from '../domain/import.constants.js';
import { assertTransition } from '../domain/import-status.machine.js';
import {
  IMPORT_AUDIT_ACTIONS,
  ImportAuditService,
} from './import-audit.service.js';
import { ImportNotifierService } from './import-notifier.service.js';

type Tx = Prisma.TransactionClient;

export type LifecycleActor = {
  userId: string | null;
  role: string;
  party: ImportTradeParty;
};

export const SYSTEM_ACTOR: LifecycleActor = {
  userId: null,
  role: 'SYSTEM',
  party: ImportTradeParty.SYSTEM,
};

export type NegotiationEventInput = Omit<
  Prisma.ImportNegotiationEventUncheckedCreateInput,
  'id' | 'negotiationId' | 'sequence' | 'createdAt'
>;

type ClosedNegotiation = {
  id: string;
  referenceNumber: string;
  buyerOrgId: string;
  sellerOrgId: string;
};

const ENDABLE: ImportListingStatus[] = [
  ImportListingStatus.DRAFT,
  ImportListingStatus.PUBLISHED,
  ImportListingStatus.MATCHING,
  ImportListingStatus.OFFER_RECEIVED,
  ImportListingStatus.NEGOTIATION,
  ImportListingStatus.MATCHED,
  ImportListingStatus.PAUSED,
];

@Injectable()
export class ImportLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: ImportAuditService,
    private readonly notifier: ImportNotifierService,
  ) {}

  /** Appends one immutable event; the row lock on the negotiation serialises sequences. */
  async appendEvent(
    tx: Tx,
    negotiationId: string,
    data: NegotiationEventInput,
  ) {
    const last = await tx.importNegotiationEvent.findFirst({
      where: { negotiationId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });
    return tx.importNegotiationEvent.create({
      data: { ...data, negotiationId, sequence: (last?.sequence ?? 0) + 1 },
    });
  }

  /** SELECT ... FOR UPDATE so concurrent counter/accept calls cannot interleave. */
  async lockNegotiation(tx: Tx, negotiationId: string) {
    await tx.$queryRaw`SELECT id FROM import_negotiations WHERE id = ${negotiationId}::uuid FOR UPDATE`;
  }

  async lockListing(tx: Tx, listingId: string) {
    await tx.$queryRaw`SELECT id FROM import_listings WHERE id = ${listingId}::uuid FOR UPDATE`;
  }

  private async closeListingNegotiations(
    tx: Tx,
    listingId: string,
    outcome: 'EXPIRED' | 'CANCELLED',
    actor: LifecycleActor,
  ): Promise<ClosedNegotiation[]> {
    const open = await tx.importNegotiation.findMany({
      where: {
        status: ImportNegotiationStatus.OPEN,
        OR: [{ buyListingId: listingId }, { sellListingId: listingId }],
      },
      select: {
        id: true,
        referenceNumber: true,
        buyerOrgId: true,
        sellerOrgId: true,
      },
    });
    const now = new Date();
    for (const n of open) {
      await this.lockNegotiation(tx, n.id);
      await this.appendEvent(tx, n.id, {
        type:
          outcome === 'EXPIRED'
            ? ImportNegotiationEventType.EXPIRED
            : ImportNegotiationEventType.WITHDRAWN,
        actorParty: actor.party,
        actorUserId: actor.userId,
        note:
          outcome === 'EXPIRED'
            ? 'The listing expired, so this negotiation was closed.'
            : 'The listing was cancelled, so this negotiation was closed.',
      });
      await tx.importNegotiation.update({
        where: { id: n.id },
        data: {
          status:
            outcome === 'EXPIRED'
              ? ImportNegotiationStatus.EXPIRED
              : ImportNegotiationStatus.CANCELLED,
          closedAt: now,
        },
      });
    }
    return open;
  }

  /**
   * Moves a listing to EXPIRED or CANCELLED, closing its open negotiations and
   * suggested matches. Returns false when the listing was already terminal
   * (e.g. the worker and the owner raced).
   */
  async endListing(
    listingId: string,
    target: 'EXPIRED' | 'CANCELLED',
    actor: LifecycleActor,
    options: { reason?: string | null; validateTransition?: boolean } = {},
  ): Promise<boolean> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockListing(tx, listingId);
      const listing = await tx.importListing.findUnique({
        where: { id: listingId },
      });
      if (!listing || listing.deletedAt) return null;
      const next =
        target === 'EXPIRED'
          ? ImportListingStatus.EXPIRED
          : ImportListingStatus.CANCELLED;
      if (options.validateTransition !== false)
        assertTransition(listing.status, next);
      else if (!ENDABLE.includes(listing.status)) return null;

      const now = new Date();
      await tx.importListing.update({
        where: { id: listingId },
        data: {
          status: next,
          version: { increment: 1 },
          ...(target === 'EXPIRED'
            ? { expiredAt: now }
            : { cancelledAt: now, cancelReason: options.reason ?? null }),
        },
      });
      await tx.importMatch.updateMany({
        where: {
          OR: [{ buyListingId: listingId }, { sellListingId: listingId }],
          status: ImportMatchStatus.SUGGESTED,
        },
        data: { status: ImportMatchStatus.STALE },
      });
      const closed = await this.closeListingNegotiations(
        tx,
        listingId,
        target,
        actor,
      );
      return { listing, closed };
    });
    if (!result) return false;

    const { listing, closed } = result;
    const isBuy = listing.side === ImportSide.BUY;
    const action =
      target === 'EXPIRED'
        ? isBuy
          ? IMPORT_AUDIT_ACTIONS.BUY_EXPIRED
          : IMPORT_AUDIT_ACTIONS.SELL_EXPIRED
        : isBuy
          ? IMPORT_AUDIT_ACTIONS.BUY_CANCELLED
          : IMPORT_AUDIT_ACTIONS.SELL_CANCELLED;
    await this.audit.log({
      action,
      actorUserId: actor.userId,
      actorRole: actor.role,
      organizationId: listing.ownerOrgId,
      entityType: EntityOwnerType.IMPORT_LISTING,
      entityId: listing.id,
      previousData: { status: listing.status },
      newData: { status: target },
      metadata: {
        referenceNumber: listing.referenceNumber,
        side: listing.side,
        reason: options.reason ?? null,
        closedNegotiations: closed.map((n) => n.referenceNumber),
      },
    });

    const label = isBuy ? 'RFQ' : 'offer';
    if (target === 'EXPIRED') {
      await this.notifier.notify({
        organizationId: listing.ownerOrgId,
        event: IMPORT_NOTIFICATION_EVENTS.EXPIRED,
        title: `Import ${label} expired`,
        body: `Your ${label} ${listing.referenceNumber} has expired and is no longer visible to counterparties.`,
        entityType: EntityOwnerType.IMPORT_LISTING,
        entityId: listing.id,
        metadata: {
          listingId: listing.id,
          referenceNumber: listing.referenceNumber,
          side: listing.side,
        },
      });
    }
    for (const n of closed) {
      const counterpartyOrg = isBuy ? n.sellerOrgId : n.buyerOrgId;
      await this.notifier.notify({
        organizationId: counterpartyOrg,
        event: IMPORT_NOTIFICATION_EVENTS.NEGOTIATION_WITHDRAWN,
        title: 'Import negotiation closed',
        body: `Negotiation ${n.referenceNumber} was closed because ${listing.referenceNumber} ${target === 'EXPIRED' ? 'expired' : 'was cancelled'}.`,
        entityType: EntityOwnerType.IMPORT_NEGOTIATION,
        entityId: n.id,
        metadata: {
          negotiationId: n.id,
          referenceNumber: n.referenceNumber,
          listingReference: listing.referenceNumber,
        },
      });
    }
    return true;
  }

  /** Closes an OPEN negotiation whose response window lapsed. */
  async expireNegotiation(negotiationId: string): Promise<boolean> {
    const closed = await this.prisma.$transaction(async (tx) => {
      await this.lockNegotiation(tx, negotiationId);
      const n = await tx.importNegotiation.findUnique({
        where: { id: negotiationId },
      });
      if (
        !n ||
        n.status !== ImportNegotiationStatus.OPEN ||
        !n.expiresAt ||
        n.expiresAt > new Date()
      ) {
        return null;
      }
      await this.appendEvent(tx, n.id, {
        type: ImportNegotiationEventType.EXPIRED,
        actorParty: ImportTradeParty.SYSTEM,
        note: 'No response within the negotiation window.',
      });
      await tx.importNegotiation.update({
        where: { id: n.id },
        data: { status: ImportNegotiationStatus.EXPIRED, closedAt: new Date() },
      });
      if (n.matchId) {
        await tx.importMatch.updateMany({
          where: { id: n.matchId, status: ImportMatchStatus.NEGOTIATING },
          data: { status: ImportMatchStatus.SUGGESTED },
        });
      }
      return n;
    });
    if (!closed) return false;

    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.NEGOTIATION_EXPIRED,
      actorUserId: null,
      actorRole: 'SYSTEM',
      organizationId: closed.buyerOrgId,
      entityType: EntityOwnerType.IMPORT_NEGOTIATION,
      entityId: closed.id,
      metadata: { referenceNumber: closed.referenceNumber },
    });
    for (const org of [closed.buyerOrgId, closed.sellerOrgId]) {
      await this.notifier.notify({
        organizationId: org,
        event: IMPORT_NOTIFICATION_EVENTS.NEGOTIATION_WITHDRAWN,
        title: 'Import negotiation expired',
        body: `Negotiation ${closed.referenceNumber} expired without a response.`,
        entityType: EntityOwnerType.IMPORT_NEGOTIATION,
        entityId: closed.id,
        metadata: {
          negotiationId: closed.id,
          referenceNumber: closed.referenceNumber,
        },
      });
    }
    return true;
  }
}
