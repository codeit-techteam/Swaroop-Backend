import { Injectable } from '@nestjs/common';
import {
  EntityOwnerType,
  ImportDealStatus,
  ImportListingStatus,
  ImportTradeParty,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  ImportActorService,
  type ImportActor,
} from '../common/import-actor.service.js';
import {
  IMPORT_AUDIT_ACTIONS,
  ImportAuditService,
} from '../common/import-audit.service.js';
import { ImportIdempotencyService } from '../common/import-idempotency.service.js';
import { ImportNotifierService } from '../common/import-notifier.service.js';
import { decimalString } from '../domain/import-decimal.js';
import { IMPORT_NOTIFICATION_EVENTS } from '../domain/import.constants.js';
import { ImportException } from '../domain/import.errors.js';
import { canTransition } from '../domain/import-status.machine.js';
import { importPartyRef } from '../listings/import-listing.mapper.js';
import type { ListDealsQueryDto } from '../negotiations/dto/import-negotiation.dto.js';
import { ImportShipmentsService } from '../shipments/import-shipments.service.js';

export const DEAL_INCLUDE = {
  negotiation: { select: { id: true, referenceNumber: true } },
  buyListing: { select: { id: true, referenceNumber: true } },
  sellListing: { select: { id: true, referenceNumber: true } },
  buyerOrg: { select: { id: true, name: true, legalName: true } },
  sellerOrg: { select: { id: true, name: true, legalName: true } },
} satisfies Prisma.ImportDealInclude;

type DealRow = Prisma.ImportDealGetPayload<{ include: typeof DEAL_INCLUDE }>;

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function mapDeal(d: DealRow, party: ImportTradeParty | 'ADMIN') {
  // Identities stay hidden until both parties have confirmed.
  const revealed =
    party === 'ADMIN' || d.status !== ImportDealStatus.PENDING_CONFIRMATION;
  const org = (o: DealRow['buyerOrg']) => ({
    id: o.id,
    name: o.legalName ?? o.name,
  });
  const myConfirmedAt =
    party === ImportTradeParty.BUYER
      ? d.buyerConfirmedAt
      : party === ImportTradeParty.SELLER
        ? d.sellerConfirmedAt
        : null;
  return {
    id: d.id,
    referenceNumber: d.referenceNumber,
    status: d.status,
    myParty: party,
    negotiation: d.negotiation,
    buyListing: d.buyListing,
    sellListing: d.sellListing,
    buyerRef: importPartyRef('BUYER', d.buyerOrgId),
    sellerRef: importPartyRef('SELLER', d.sellerOrgId),
    ...(revealed ? { buyer: org(d.buyerOrg), seller: org(d.sellerOrg) } : {}),
    price: decimalString(d.price),
    currencyCode: d.currencyCode,
    priceUnit: d.priceUnit,
    quantity: decimalString(d.quantity),
    quantityUnit: d.quantityUnit,
    incotermCode: d.incotermCode,
    priceBasisLocation: d.priceBasisLocation,
    paymentTermName: d.paymentTermName,
    esd: dateOnly(d.esd),
    lsd: dateOnly(d.lsd),
    terms: d.terms,
    buyerConfirmedAt: d.buyerConfirmedAt,
    sellerConfirmedAt: d.sellerConfirmedAt,
    awaitingMyConfirmation:
      party !== 'ADMIN' &&
      d.status === ImportDealStatus.PENDING_CONFIRMATION &&
      !myConfirmedAt,
    confirmedAt: d.confirmedAt,
    cancelledAt: d.cancelledAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

@Injectable()
export class ImportDealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actors: ImportActorService,
    private readonly idempotency: ImportIdempotencyService,
    private readonly audit: ImportAuditService,
    private readonly notifier: ImportNotifierService,
    private readonly shipments: ImportShipmentsService,
  ) {}

  private scope(
    actor: ImportActor,
    as?: 'buyer' | 'seller',
  ): Prisma.ImportDealWhereInput {
    const or: Prisma.ImportDealWhereInput[] = [];
    if (actor.buyer && as !== 'seller')
      or.push({ buyerOrgId: actor.buyer.organizationId });
    if (actor.seller && as !== 'buyer')
      or.push({ sellerOrgId: actor.seller.organizationId });
    if (!or.length) throw new ImportException('IMPORT_PROFILE_REQUIRED');
    return { OR: or };
  }

  async list(user: AuthenticatedUser, query: ListDealsQueryDto) {
    const actor = await this.actors.resolve(user);
    const where: Prisma.ImportDealWhereInput = {
      AND: [
        this.scope(actor, query.as),
        query.status ? { status: query.status } : {},
        query.search
          ? {
              referenceNumber: {
                contains: query.search.trim(),
                mode: Prisma.QueryMode.insensitive,
              },
            }
          : {},
      ],
    };
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const [rows, total] = await Promise.all([
      this.prisma.importDeal.findMany({
        where,
        include: DEAL_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.importDeal.count({ where }),
    ]);
    return {
      items: rows.map((d) => mapDeal(d, this.actors.partyFor(actor, d)!)),
      meta: paginationMeta(page, limit, total),
    };
  }

  private async load(actor: ImportActor, id: string) {
    const deal = await this.prisma.importDeal.findUnique({
      where: { id },
      include: DEAL_INCLUDE,
    });
    if (!deal) throw new ImportException('DEAL_NOT_FOUND');
    const party = this.actors.partyFor(actor, deal);
    if (!party) throw new ImportException('DEAL_NOT_FOUND');
    return { deal, party };
  }

  async get(user: AuthenticatedUser, id: string) {
    const actor = await this.actors.resolve(user);
    const { deal, party } = await this.load(actor, id);
    return {
      ...mapDeal(deal, party),
      shipments: await this.shipments.forDeal(deal.id, party),
    };
  }

  async confirm(user: AuthenticatedUser, id: string, rawKey?: string) {
    const actor = await this.actors.resolve(user);
    const key = this.idempotency.normalise(rawKey);
    const replayed = await this.idempotency.replay(
      actor.userId,
      'DEAL_CONFIRM',
      key,
    );
    if (replayed) return this.get(user, id);

    const { deal, party } = await this.load(actor, id);
    if (deal.status !== ImportDealStatus.PENDING_CONFIRMATION) {
      throw new ImportException(
        'IMPORT_INVALID_STATUS_TRANSITION',
        `This deal is ${deal.status.toLowerCase().replace(/_/g, ' ')}.`,
      );
    }
    const already =
      party === ImportTradeParty.BUYER
        ? deal.buyerConfirmedAt
        : deal.sellerConfirmedAt;
    if (already)
      throw new ImportException(
        'DUPLICATE_REQUEST',
        'You have already confirmed this deal.',
      );
    if (party === ImportTradeParty.BUYER)
      this.actors.assertBuyerCanTrade(this.actors.requireBuyer(actor));
    else this.actors.assertSellerCanTrade(this.actors.requireSeller(actor));

    const now = new Date();
    const fullyConfirmed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM import_deals WHERE id = ${id}::uuid FOR UPDATE`;
      const fresh = await tx.importDeal.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== ImportDealStatus.PENDING_CONFIRMATION) {
        throw new ImportException(
          'IMPORT_INVALID_STATUS_TRANSITION',
          'This deal changed; refresh and try again.',
        );
      }
      const buyerAt =
        party === ImportTradeParty.BUYER ? now : fresh.buyerConfirmedAt;
      const sellerAt =
        party === ImportTradeParty.SELLER ? now : fresh.sellerConfirmedAt;
      const both = !!buyerAt && !!sellerAt;
      await tx.importDeal.update({
        where: { id },
        data: {
          buyerConfirmedAt: buyerAt,
          sellerConfirmedAt: sellerAt,
          ...(both
            ? { status: ImportDealStatus.CONFIRMED, confirmedAt: now }
            : {}),
        },
      });
      if (both) {
        for (const listingId of [fresh.buyListingId, fresh.sellListingId]) {
          if (!listingId) continue;
          const l = await tx.importListing.findUnique({
            where: { id: listingId },
            select: { status: true },
          });
          if (
            l &&
            canTransition(l.status, ImportListingStatus.DEAL_CONFIRMED)
          ) {
            await tx.importListing.update({
              where: { id: listingId },
              data: { status: ImportListingStatus.DEAL_CONFIRMED },
            });
          }
        }
      }
      await this.idempotency.record(tx, actor.userId, 'DEAL_CONFIRM', key, id);
      return both;
    });

    await this.audit.log({
      action: fullyConfirmed
        ? IMPORT_AUDIT_ACTIONS.DEAL_CONFIRMED
        : IMPORT_AUDIT_ACTIONS.DEAL_PARTY_CONFIRMED,
      actorUserId: actor.userId,
      actorRole: this.actors.actorRole(actor, party),
      organizationId:
        party === ImportTradeParty.BUYER ? deal.buyerOrgId : deal.sellerOrgId,
      entityType: EntityOwnerType.IMPORT_DEAL,
      entityId: id,
      previousData: { status: deal.status },
      newData: {
        status: fullyConfirmed ? ImportDealStatus.CONFIRMED : deal.status,
        confirmedBy: party,
      },
      metadata: { referenceNumber: deal.referenceNumber, party },
    });

    if (fullyConfirmed) {
      for (const org of [deal.buyerOrgId, deal.sellerOrgId]) {
        await this.notifier.notify({
          organizationId: org,
          event: IMPORT_NOTIFICATION_EVENTS.DEAL_CONFIRMED,
          title: 'Import deal confirmed',
          body: `Deal ${deal.referenceNumber} is confirmed by both parties: ${decimalString(deal.quantity)} ${deal.quantityUnit} at ${deal.currencyCode} ${decimalString(deal.price)}/${deal.priceUnit}${deal.incotermCode ? ` ${deal.incotermCode}` : ''}.`,
          entityType: EntityOwnerType.IMPORT_DEAL,
          entityId: id,
          metadata: { dealId: id, referenceNumber: deal.referenceNumber },
        });
      }
    } else {
      await this.notifier.notify({
        organizationId:
          party === ImportTradeParty.BUYER ? deal.sellerOrgId : deal.buyerOrgId,
        event: IMPORT_NOTIFICATION_EVENTS.DEAL_CONFIRMATION_REQUIRED,
        title: 'Confirm Import deal',
        body: `The other party confirmed deal ${deal.referenceNumber}. Your confirmation is required.`,
        entityType: EntityOwnerType.IMPORT_DEAL,
        entityId: id,
        metadata: { dealId: id, referenceNumber: deal.referenceNumber },
      });
    }
    return this.get(user, id);
  }
}
