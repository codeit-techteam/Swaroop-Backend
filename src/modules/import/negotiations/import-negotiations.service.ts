import { Injectable } from '@nestjs/common';
import {
  EntityOwnerType,
  ImportDealStatus,
  ImportListingStatus,
  ImportMatchStatus,
  ImportNegotiationEventType,
  ImportNegotiationStatus,
  ImportSide,
  ImportTradeParty,
  MasterStatus,
  Prisma,
  type ImportListing,
  type ImportNegotiationEvent,
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
import { ImportLifecycleService } from '../common/import-lifecycle.service.js';
import { ImportNotifierService } from '../common/import-notifier.service.js';
import { ImportReferenceService } from '../common/import-reference.service.js';
import { ImportSettingsService } from '../common/import-settings.service.js';
import { decimalString, toDecimal } from '../domain/import-decimal.js';
import {
  IMPORT_NOTIFICATION_EVENTS,
  OPEN_LISTING_STATUSES,
} from '../domain/import.constants.js';
import {
  ImportException,
  throwFieldErrors,
  type ImportFieldError,
} from '../domain/import.errors.js';
import {
  advanceStatus,
  canTransition,
} from '../domain/import-status.machine.js';
import { startOfUtcDay } from '../domain/import-validation.js';
import { importPartyRef } from '../listings/import-listing.mapper.js';
import type { ListingSnapshot } from '../common/import-master.service.js';
import type {
  CounterOfferDto,
  ListNegotiationsQueryDto,
  NegotiationNoteDto,
  OpenNegotiationDto,
} from './dto/import-negotiation.dto.js';

type Tx = Prisma.TransactionClient;
const MAX_ROUNDS = 30;

const LISTING_SUMMARY_SELECT = {
  id: true,
  referenceNumber: true,
  side: true,
  status: true,
  snapshot: true,
  quantity: true,
  quantityUnit: true,
  price: true,
  currencyCode: true,
  priceUnit: true,
  incotermId: true,
  priceBasisLocation: true,
  validUntil: true,
  ownerOrgId: true,
} satisfies Prisma.ImportListingSelect;

const NEGOTIATION_INCLUDE = {
  buyListing: { select: LISTING_SUMMARY_SELECT },
  sellListing: { select: LISTING_SUMMARY_SELECT },
  events: { orderBy: { sequence: 'desc' as const }, take: 1 },
  deal: { select: { id: true, referenceNumber: true, status: true } },
} satisfies Prisma.ImportNegotiationInclude;

type NegotiationRow = Prisma.ImportNegotiationGetPayload<{
  include: typeof NEGOTIATION_INCLUDE;
}>;
type ListingSummary = Prisma.ImportListingGetPayload<{
  select: typeof LISTING_SUMMARY_SELECT;
}>;

/** Complete term set carried by every event so any round can be read on its own. */
type Terms = {
  price: Prisma.Decimal;
  quantity: Prisma.Decimal;
  moq: Prisma.Decimal | null;
  paymentTermId: string | null;
  paymentTermName: string | null;
  esd: Date | null;
  lsd: Date | null;
  inspectionType: ImportNegotiationEvent['inspectionType'];
  otherTerms: string | null;
};

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (v?: string) =>
  v ? new Date(`${v.slice(0, 10)}T00:00:00.000Z`) : undefined;

function mapEvent(e: ImportNegotiationEvent) {
  return {
    id: e.id,
    sequence: e.sequence,
    type: e.type,
    actorParty: e.actorParty,
    price: decimalString(e.price),
    currencyCode: e.currencyCode,
    priceUnit: e.priceUnit,
    quantity: decimalString(e.quantity),
    quantityUnit: e.quantityUnit,
    moq: decimalString(e.moq),
    incotermCode: e.incotermCode,
    paymentTermId: e.paymentTermId,
    paymentTermName: e.paymentTermName,
    esd: dateOnly(e.esd),
    lsd: dateOnly(e.lsd),
    inspectionType: e.inspectionType,
    otherTerms: e.otherTerms,
    note: e.note,
    createdAt: e.createdAt,
  };
}

function summarizeListing(l: ListingSummary | null) {
  if (!l) return null;
  const s = (l.snapshot ?? {}) as Partial<ListingSnapshot>;
  return {
    id: l.id,
    referenceNumber: l.referenceNumber,
    side: l.side,
    status: l.status,
    product: s.category?.name ?? null,
    grade: s.grade?.name ?? s.customGradeName ?? null,
    brand: s.brand?.name ?? null,
    originCountry: s.originCountry?.name ?? null,
    quantity: decimalString(l.quantity),
    quantityUnit: l.quantityUnit,
    price: decimalString(l.price),
    currencyCode: l.currencyCode,
    priceUnit: l.priceUnit,
    incoterm: s.incoterm?.code ?? null,
    priceBasis: s.priceBasisPort?.name ?? l.priceBasisLocation,
    pol: s.pol ? { code: s.pol.code, name: s.pol.name } : null,
    pod: s.pod ? { code: s.pod.code, name: s.pod.name } : null,
    validUntil: l.validUntil,
  };
}

@Injectable()
export class ImportNegotiationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actors: ImportActorService,
    private readonly settings: ImportSettingsService,
    private readonly references: ImportReferenceService,
    private readonly idempotency: ImportIdempotencyService,
    private readonly audit: ImportAuditService,
    private readonly notifier: ImportNotifierService,
    private readonly lifecycle: ImportLifecycleService,
  ) {}

  // ---------------------------------------------------------------------------
  // Mapping
  // ---------------------------------------------------------------------------

  map(n: NegotiationRow, party: ImportTradeParty, now = new Date()) {
    const latest = n.events[0] ?? null;
    const primary =
      n.initiatedBy === ImportTradeParty.BUYER ? n.sellListing : n.buyListing;
    const counterpartyRef =
      party === ImportTradeParty.BUYER
        ? importPartyRef('SELLER', n.sellerOrgId)
        : importPartyRef('BUYER', n.buyerOrgId);
    return {
      id: n.id,
      referenceNumber: n.referenceNumber,
      status: n.status,
      myParty: party,
      counterpartyRef,
      initiatedBy: n.initiatedBy,
      lastActorParty: n.lastActorParty,
      roundCount: n.roundCount,
      awaitingMyResponse:
        n.status === ImportNegotiationStatus.OPEN && n.lastActorParty !== party,
      expiresAt: n.expiresAt,
      isExpired: !!n.expiresAt && n.expiresAt <= now,
      agreedAt: n.agreedAt,
      closedAt: n.closedAt,
      listing: summarizeListing(primary),
      buyListing: summarizeListing(n.buyListing),
      sellListing: summarizeListing(n.sellListing),
      latestTerms: latest ? mapEvent(latest) : null,
      deal: n.deal,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Validation helpers
  // ---------------------------------------------------------------------------

  private async resolvePaymentTerm(
    id: string | null | undefined,
    currencyCode: string | null,
  ) {
    if (!id) return null;
    const term = await this.prisma.paymentTerm.findUnique({ where: { id } });
    if (
      !term ||
      term.deletedAt ||
      term.status !== MasterStatus.ACTIVE ||
      !term.importEnabled
    ) {
      throw new ImportException('INVALID_PAYMENT_TERM');
    }
    if (
      currencyCode &&
      term.currencyCodes.length &&
      !term.currencyCodes.includes(currencyCode)
    ) {
      throw new ImportException(
        'INVALID_PAYMENT_TERM',
        `This payment term is not available for ${currencyCode}.`,
      );
    }
    return term;
  }

  /** Terms must stay inside what the listing allows (MOQ, max quantity, acceptable range). */
  private validateTerms(listing: ImportListing, terms: Terms) {
    const errors: ImportFieldError[] = [];
    if (terms.price.lte(0)) {
      errors.push({
        field: 'price',
        code: 'INVALID_PRICE',
        message: 'Price must be greater than 0.',
      });
    }
    if (terms.quantity.lte(0)) {
      errors.push({
        field: 'quantity',
        code: 'INVALID_QUANTITY',
        message: 'Quantity must be greater than 0.',
      });
    }
    // Negotiated quantities are always in the listing's own unit.
    const q = terms.quantity;
    const unit = listing.quantityUnit;
    if (listing.side === ImportSide.SELL) {
      if (listing.moq && q.lt(listing.moq)) {
        errors.push({
          field: 'quantity',
          code: 'INVALID_QUANTITY',
          message: `Quantity is below the MOQ of ${decimalString(listing.moq)} ${unit}.`,
        });
      }
      const cap = listing.maximumQuantity ?? listing.quantity;
      if (cap && q.gt(cap)) {
        errors.push({
          field: 'quantity',
          code: 'INVALID_QUANTITY',
          message: 'Quantity exceeds what this offer can supply.',
        });
      }
    } else {
      const min = listing.acceptableQuantityMin;
      const max = listing.acceptableQuantityMax ?? listing.quantity;
      if (min && q.lt(min)) {
        errors.push({
          field: 'quantity',
          code: 'INVALID_QUANTITY',
          message: "Quantity is below the buyer's minimum acceptable quantity.",
        });
      }
      if (max && q.gt(max)) {
        errors.push({
          field: 'quantity',
          code: 'INVALID_QUANTITY',
          message: "Quantity exceeds the buyer's maximum acceptable quantity.",
        });
      }
    }
    if (terms.moq && terms.moq.gt(terms.quantity)) {
      errors.push({
        field: 'moq',
        code: 'INVALID_QUANTITY',
        message: 'MOQ cannot exceed the quantity.',
      });
    }
    if (terms.esd && terms.lsd && terms.esd > terms.lsd) {
      errors.push({
        field: 'lsd',
        code: 'INVALID_SHIPMENT_WINDOW',
        message:
          'Earliest shipment date must be on or before the latest shipment date.',
      });
    }
    if (terms.lsd && terms.lsd < startOfUtcDay(new Date())) {
      errors.push({
        field: 'lsd',
        code: 'INVALID_SHIPMENT_WINDOW',
        message: 'Latest shipment date cannot be in the past.',
      });
    }
    throwFieldErrors(errors);
  }

  private isListingLive(
    l: Pick<ImportListing, 'status' | 'validUntil' | 'deletedAt'>,
    now: Date,
  ) {
    return (
      OPEN_LISTING_STATUSES.includes(l.status) &&
      !l.deletedAt &&
      (!l.validUntil || l.validUntil > now)
    );
  }

  private eventData(
    listing: ImportListing,
    terms: Terms,
    incotermCode: string | null,
  ) {
    return {
      price: terms.price,
      currencyCode: listing.currencyCode,
      priceUnit: listing.priceUnit,
      quantity: terms.quantity,
      quantityUnit: listing.quantityUnit,
      moq: terms.moq,
      incotermId: listing.incotermId,
      incotermCode,
      paymentTermId: terms.paymentTermId,
      paymentTermName: terms.paymentTermName,
      esd: terms.esd,
      lsd: terms.lsd,
      inspectionType: terms.inspectionType,
      otherTerms: terms.otherTerms,
    };
  }

  private snapshotOf(listing: ImportListing) {
    return (listing.snapshot ?? {}) as Partial<ListingSnapshot>;
  }

  private async bumpListing(
    tx: Tx,
    listingId: string | null,
    target: ImportListingStatus,
  ) {
    if (!listingId) return;
    const l = await tx.importListing.findUnique({
      where: { id: listingId },
      select: { status: true },
    });
    if (!l) return;
    const next = advanceStatus(l.status, target);
    if (next !== l.status && canTransition(l.status, next)) {
      await tx.importListing.update({
        where: { id: listingId },
        data: { status: next },
      });
    }
  }

  private async expiryFor(listing: ImportListing, now: Date) {
    const { negotiationTtlHours } = await this.settings.get();
    const ttl = new Date(now.getTime() + negotiationTtlHours * 3600_000);
    return listing.validUntil && listing.validUntil < ttl
      ? listing.validUntil
      : ttl;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async open(
    user: AuthenticatedUser,
    dto: OpenNegotiationDto,
    rawKey?: string,
  ) {
    const actor = await this.actors.resolve(user);
    const key = this.idempotency.normalise(rawKey);
    const replayed = await this.idempotency.replay(
      actor.userId,
      'NEGOTIATION_OPEN',
      key,
    );
    if (replayed) return this.get(user, replayed);

    const now = new Date();
    const listing = await this.prisma.importListing.findFirst({
      where: { id: dto.listingId, deletedAt: null },
    });
    if (!listing) throw new ImportException('IMPORT_NOT_FOUND');
    if (!this.isListingLive(listing, now)) {
      throw new ImportException(
        listing.validUntil && listing.validUntil <= now
          ? 'OFFER_EXPIRED'
          : 'NEGOTIATION_NOT_ALLOWED',
        listing.validUntil && listing.validUntil <= now
          ? undefined
          : 'This listing is not open for negotiation.',
      );
    }

    // Buyers respond to SELL offers; sellers respond to BUY requests.
    const party =
      listing.side === ImportSide.SELL
        ? ImportTradeParty.BUYER
        : ImportTradeParty.SELLER;
    let buyerOrgId: string;
    let sellerOrgId: string;
    if (party === ImportTradeParty.BUYER) {
      const buyer = this.actors.requireBuyer(actor);
      this.actors.assertBuyerCanTrade(buyer);
      buyerOrgId = buyer.organizationId;
      sellerOrgId = listing.ownerOrgId;
    } else {
      const seller = this.actors.requireSeller(actor);
      this.actors.assertSellerCanTrade(seller);
      sellerOrgId = seller.organizationId;
      buyerOrgId = listing.ownerOrgId;
    }
    if (buyerOrgId === sellerOrgId) {
      throw new ImportException(
        'NEGOTIATION_NOT_ALLOWED',
        'You cannot negotiate on your own listing.',
      );
    }

    let counter: ImportListing | null = null;
    if (dto.counterListingId) {
      counter = await this.prisma.importListing.findFirst({
        where: {
          id: dto.counterListingId,
          deletedAt: null,
          side:
            listing.side === ImportSide.SELL ? ImportSide.BUY : ImportSide.SELL,
          ownerOrgId:
            party === ImportTradeParty.BUYER ? buyerOrgId : sellerOrgId,
        },
      });
      if (!counter || !this.isListingLive(counter, now)) {
        throw new ImportException(
          'NEGOTIATION_NOT_ALLOWED',
          'Your linked listing is not open.',
        );
      }
      if (counter.categoryId !== listing.categoryId) {
        throw new ImportException(
          'NEGOTIATION_NOT_ALLOWED',
          'Your linked listing is for a different product.',
        );
      }
    }

    const term = await this.resolvePaymentTerm(
      dto.paymentTermId ?? listing.paymentTermId,
      listing.currencyCode,
    );
    const terms: Terms = {
      price: toDecimal(dto.price)!,
      quantity: toDecimal(dto.quantity)!,
      moq: dto.moq ? toDecimal(dto.moq) : listing.moq,
      paymentTermId: term?.id ?? null,
      paymentTermName: term ? (term.displayName ?? term.name) : null,
      esd: toDate(dto.esd) ?? listing.esd,
      lsd: toDate(dto.lsd) ?? listing.lsd,
      inspectionType: dto.inspectionType ?? listing.inspectionType,
      otherTerms: dto.otherTerms?.trim() || null,
    };
    this.validateTerms(listing, terms);
    const snapshot = this.snapshotOf(listing);
    const buyListingId =
      listing.side === ImportSide.BUY ? listing.id : (counter?.id ?? null);
    const sellListingId =
      listing.side === ImportSide.SELL ? listing.id : (counter?.id ?? null);
    const expiresAt = await this.expiryFor(listing, now);

    let negotiationId: string;
    try {
      negotiationId = await this.prisma.$transaction(async (tx) => {
        await this.lifecycle.lockListing(tx, listing.id);
        const match =
          buyListingId && sellListingId
            ? await tx.importMatch.findUnique({
                where: {
                  buyListingId_sellListingId: { buyListingId, sellListingId },
                },
                select: { id: true },
              })
            : null;
        const referenceNumber = await this.references.next('NEGOTIATION', tx);
        const created = await tx.importNegotiation.create({
          data: {
            referenceNumber,
            status: ImportNegotiationStatus.OPEN,
            buyListingId,
            sellListingId,
            matchId: match?.id ?? null,
            buyerOrgId,
            sellerOrgId,
            initiatedBy: party,
            lastActorParty: party,
            roundCount: 1,
            expiresAt,
          },
        });
        await this.lifecycle.appendEvent(tx, created.id, {
          type: ImportNegotiationEventType.OPENED,
          actorParty: party,
          actorUserId: actor.userId,
          ...this.eventData(listing, terms, snapshot.incoterm?.code ?? null),
          note: dto.note?.trim() || null,
        });
        if (match) {
          await tx.importMatch.update({
            where: { id: match.id },
            data: { status: ImportMatchStatus.NEGOTIATING },
          });
        }
        await this.bumpListing(
          tx,
          listing.id,
          ImportListingStatus.OFFER_RECEIVED,
        );
        await this.idempotency.record(
          tx,
          actor.userId,
          'NEGOTIATION_OPEN',
          key,
          created.id,
        );
        return created.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ImportException(
          'NEGOTIATION_NOT_ALLOWED',
          'You already have an open negotiation on this listing.',
        );
      }
      throw error;
    }

    const created = await this.prisma.importNegotiation.findUniqueOrThrow({
      where: { id: negotiationId },
    });
    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.NEGOTIATION_STARTED,
      actorUserId: actor.userId,
      actorRole: this.actors.actorRole(actor, party),
      organizationId:
        party === ImportTradeParty.BUYER ? buyerOrgId : sellerOrgId,
      entityType: EntityOwnerType.IMPORT_NEGOTIATION,
      entityId: negotiationId,
      newData: {
        price: terms.price.toString(),
        quantity: terms.quantity.toString(),
        currencyCode: listing.currencyCode,
      },
      metadata: {
        referenceNumber: created.referenceNumber,
        listingReference: listing.referenceNumber,
        party,
      },
    });
    await this.notifier.notify({
      organizationId: listing.ownerOrgId,
      event: IMPORT_NOTIFICATION_EVENTS.RESPONSE_RECEIVED,
      title:
        listing.side === ImportSide.BUY
          ? 'New offer on your Import RFQ'
          : 'New response to your Import offer',
      body: `${listing.referenceNumber}: ${decimalString(terms.quantity)} ${listing.quantityUnit} at ${listing.currencyCode ?? ''} ${decimalString(terms.price)}/${listing.priceUnit}. Negotiation ${created.referenceNumber}.`,
      entityType: EntityOwnerType.IMPORT_NEGOTIATION,
      entityId: negotiationId,
      metadata: {
        negotiationId,
        referenceNumber: created.referenceNumber,
        listingId: listing.id,
        listingReference: listing.referenceNumber,
      },
    });
    return this.get(user, negotiationId);
  }

  /** Loads a negotiation the caller is party to, expiring it lazily if overdue. */
  private async loadForParty(actor: ImportActor, id: string) {
    let n = await this.prisma.importNegotiation.findUnique({
      where: { id },
      include: NEGOTIATION_INCLUDE,
    });
    if (!n) throw new ImportException('NEGOTIATION_NOT_FOUND');
    const party = this.actors.partyFor(actor, n);
    if (!party) throw new ImportException('NEGOTIATION_NOT_FOUND');
    if (
      n.status === ImportNegotiationStatus.OPEN &&
      n.expiresAt &&
      n.expiresAt <= new Date()
    ) {
      await this.lifecycle.expireNegotiation(n.id);
      n = await this.prisma.importNegotiation.findUniqueOrThrow({
        where: { id },
        include: NEGOTIATION_INCLUDE,
      });
    }
    return { n, party };
  }

  private assertOpen(n: NegotiationRow) {
    if (n.status === ImportNegotiationStatus.EXPIRED)
      throw new ImportException('OFFER_EXPIRED');
    if (n.status !== ImportNegotiationStatus.OPEN) {
      throw new ImportException(
        'NEGOTIATION_NOT_ALLOWED',
        `This negotiation is ${n.status.toLowerCase()}.`,
      );
    }
  }

  private assertMyTurn(n: NegotiationRow, party: ImportTradeParty) {
    if (n.lastActorParty === party) {
      throw new ImportException(
        'NEGOTIATION_NOT_ALLOWED',
        'Waiting for the other party to respond.',
      );
    }
  }

  private primaryListingId(n: {
    initiatedBy: ImportTradeParty;
    buyListingId: string | null;
    sellListingId: string | null;
  }) {
    return (
      n.initiatedBy === ImportTradeParty.BUYER
        ? n.sellListingId
        : n.buyListingId
    )!;
  }

  private otherOrg(
    n: { buyerOrgId: string; sellerOrgId: string },
    party: ImportTradeParty,
  ) {
    return party === ImportTradeParty.BUYER ? n.sellerOrgId : n.buyerOrgId;
  }

  async counter(
    user: AuthenticatedUser,
    id: string,
    dto: CounterOfferDto,
    rawKey?: string,
  ) {
    const actor = await this.actors.resolve(user);
    const key = this.idempotency.normalise(rawKey);
    const replayed = await this.idempotency.replay(
      actor.userId,
      'NEGOTIATION_COUNTER',
      key,
    );
    if (replayed) return this.get(user, id);

    const { n, party } = await this.loadForParty(actor, id);
    this.assertOpen(n);
    this.assertMyTurn(n, party);
    if (n.roundCount >= MAX_ROUNDS) {
      throw new ImportException(
        'NEGOTIATION_NOT_ALLOWED',
        `Negotiations are limited to ${MAX_ROUNDS} rounds.`,
      );
    }
    if (party === ImportTradeParty.BUYER)
      this.actors.assertBuyerCanTrade(this.actors.requireBuyer(actor));
    else this.actors.assertSellerCanTrade(this.actors.requireSeller(actor));

    const listing = await this.prisma.importListing.findUniqueOrThrow({
      where: { id: this.primaryListingId(n) },
    });
    const last = await this.prisma.importNegotiationEvent.findFirstOrThrow({
      where: { negotiationId: id, price: { not: null } },
      orderBy: { sequence: 'desc' },
    });
    const term =
      dto.paymentTermId !== undefined
        ? await this.resolvePaymentTerm(dto.paymentTermId, listing.currencyCode)
        : null;
    const terms: Terms = {
      price: dto.price ? toDecimal(dto.price)! : last.price!,
      quantity: dto.quantity ? toDecimal(dto.quantity)! : last.quantity!,
      moq: dto.moq ? toDecimal(dto.moq) : last.moq,
      paymentTermId: term ? term.id : last.paymentTermId,
      paymentTermName: term
        ? (term.displayName ?? term.name)
        : last.paymentTermName,
      esd: toDate(dto.esd) ?? last.esd,
      lsd: toDate(dto.lsd) ?? last.lsd,
      inspectionType: dto.inspectionType ?? last.inspectionType,
      otherTerms:
        dto.otherTerms !== undefined
          ? dto.otherTerms.trim() || null
          : last.otherTerms,
    };
    this.validateTerms(listing, terms);
    const now = new Date();
    const expiresAt = await this.expiryFor(listing, now);

    await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.lockNegotiation(tx, id);
      const fresh = await tx.importNegotiation.findUniqueOrThrow({
        where: { id },
      });
      if (
        fresh.status !== ImportNegotiationStatus.OPEN ||
        fresh.lastActorParty === party
      ) {
        throw new ImportException(
          'NEGOTIATION_NOT_ALLOWED',
          'The negotiation changed; refresh and try again.',
        );
      }
      await this.lifecycle.appendEvent(tx, id, {
        type: ImportNegotiationEventType.COUNTER,
        actorParty: party,
        actorUserId: actor.userId,
        ...this.eventData(listing, terms, last.incotermCode),
        note: dto.note?.trim() || null,
      });
      await tx.importNegotiation.update({
        where: { id },
        data: {
          lastActorParty: party,
          roundCount: { increment: 1 },
          expiresAt,
        },
      });
      await this.bumpListing(
        tx,
        n.buyListingId,
        ImportListingStatus.NEGOTIATION,
      );
      await this.bumpListing(
        tx,
        n.sellListingId,
        ImportListingStatus.NEGOTIATION,
      );
      await this.idempotency.record(
        tx,
        actor.userId,
        'NEGOTIATION_COUNTER',
        key,
        id,
      );
    });

    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.COUNTEROFFER_CREATED,
      actorUserId: actor.userId,
      actorRole: this.actors.actorRole(actor, party),
      organizationId:
        party === ImportTradeParty.BUYER ? n.buyerOrgId : n.sellerOrgId,
      entityType: EntityOwnerType.IMPORT_NEGOTIATION,
      entityId: id,
      previousData: {
        price: decimalString(last.price),
        quantity: decimalString(last.quantity),
      },
      newData: {
        price: terms.price.toString(),
        quantity: terms.quantity.toString(),
      },
      metadata: {
        referenceNumber: n.referenceNumber,
        party,
        round: n.roundCount + 1,
      },
    });
    await this.notifier.notify({
      organizationId: this.otherOrg(n, party),
      event: IMPORT_NOTIFICATION_EVENTS.COUNTEROFFER_RECEIVED,
      title: 'Import counteroffer received',
      body: `Negotiation ${n.referenceNumber}: ${decimalString(terms.quantity)} ${listing.quantityUnit} at ${listing.currencyCode ?? ''} ${decimalString(terms.price)}/${listing.priceUnit}.`,
      entityType: EntityOwnerType.IMPORT_NEGOTIATION,
      entityId: id,
      metadata: { negotiationId: id, referenceNumber: n.referenceNumber },
    });
    return this.get(user, id);
  }

  async accept(user: AuthenticatedUser, id: string, rawKey?: string) {
    const actor = await this.actors.resolve(user);
    const key = this.idempotency.normalise(rawKey);
    const replayed = await this.idempotency.replay(
      actor.userId,
      'NEGOTIATION_ACCEPT',
      key,
    );
    if (replayed) return this.get(user, id);

    const { n, party } = await this.loadForParty(actor, id);
    this.assertOpen(n);
    this.assertMyTurn(n, party);
    if (party === ImportTradeParty.BUYER)
      this.actors.assertBuyerCanTrade(this.actors.requireBuyer(actor));
    else this.actors.assertSellerCanTrade(this.actors.requireSeller(actor));

    const primary = await this.prisma.importListing.findUniqueOrThrow({
      where: { id: this.primaryListingId(n) },
    });
    if (!OPEN_LISTING_STATUSES.includes(primary.status)) {
      throw new ImportException(
        'NEGOTIATION_NOT_ALLOWED',
        primary.status === ImportListingStatus.MATCHED ||
          primary.status === ImportListingStatus.DEAL_CONFIRMED
          ? 'This listing already has an agreed deal.'
          : 'This listing is no longer open.',
      );
    }
    if (primary.validUntil && primary.validUntil <= new Date())
      throw new ImportException('OFFER_EXPIRED');

    const now = new Date();
    const dealId = await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.lockListing(tx, primary.id);
      await this.lifecycle.lockNegotiation(tx, id);
      const fresh = await tx.importNegotiation.findUniqueOrThrow({
        where: { id },
      });
      if (
        fresh.status !== ImportNegotiationStatus.OPEN ||
        fresh.lastActorParty === party
      ) {
        throw new ImportException(
          'NEGOTIATION_NOT_ALLOWED',
          'The negotiation changed; refresh and try again.',
        );
      }
      const current = await tx.importListing.findUniqueOrThrow({
        where: { id: primary.id },
        select: { status: true },
      });
      if (!OPEN_LISTING_STATUSES.includes(current.status)) {
        throw new ImportException(
          'NEGOTIATION_NOT_ALLOWED',
          'This listing already has an agreed deal.',
        );
      }
      const last = await tx.importNegotiationEvent.findFirstOrThrow({
        where: { negotiationId: id, price: { not: null } },
        orderBy: { sequence: 'desc' },
      });
      await this.lifecycle.appendEvent(tx, id, {
        type: ImportNegotiationEventType.ACCEPTED,
        actorParty: party,
        actorUserId: actor.userId,
        price: last.price,
        currencyCode: last.currencyCode,
        priceUnit: last.priceUnit,
        quantity: last.quantity,
        quantityUnit: last.quantityUnit,
        moq: last.moq,
        incotermId: last.incotermId,
        incotermCode: last.incotermCode,
        paymentTermId: last.paymentTermId,
        paymentTermName: last.paymentTermName,
        esd: last.esd,
        lsd: last.lsd,
        inspectionType: last.inspectionType,
        otherTerms: last.otherTerms,
        note: `Accepted terms from round ${last.sequence}.`,
      });
      await tx.importNegotiation.update({
        where: { id },
        data: {
          status: ImportNegotiationStatus.AGREED,
          lastActorParty: party,
          agreedAt: now,
          closedAt: now,
        },
      });
      if (fresh.matchId) {
        await tx.importMatch.update({
          where: { id: fresh.matchId },
          data: { status: ImportMatchStatus.CONVERTED },
        });
      }
      // Sequential: an interactive transaction runs on a single connection.
      const buyL = fresh.buyListingId
        ? await tx.importListing.findUnique({
            where: { id: fresh.buyListingId },
          })
        : null;
      const sellL = fresh.sellListingId
        ? await tx.importListing.findUnique({
            where: { id: fresh.sellListingId },
          })
        : null;
      const primarySnapshot = this.snapshotOf(primary);
      const referenceNumber = await this.references.next('DEAL', tx);
      const deal = await tx.importDeal.create({
        data: {
          referenceNumber,
          negotiationId: id,
          buyListingId: fresh.buyListingId,
          sellListingId: fresh.sellListingId,
          buyerOrgId: fresh.buyerOrgId,
          sellerOrgId: fresh.sellerOrgId,
          status: ImportDealStatus.PENDING_CONFIRMATION,
          price: last.price!,
          currencyCode: last.currencyCode ?? primary.currencyCode ?? '',
          priceUnit: last.priceUnit ?? primary.priceUnit,
          quantity: last.quantity!,
          quantityUnit: last.quantityUnit ?? primary.quantityUnit,
          incotermCode: last.incotermCode,
          priceBasisLocation:
            primarySnapshot.priceBasisPort?.name ?? primary.priceBasisLocation,
          paymentTermName: last.paymentTermName,
          esd: last.esd,
          lsd: last.lsd,
          terms: {
            agreedEventSequence: last.sequence,
            moq: decimalString(last.moq),
            inspectionType: last.inspectionType,
            otherTerms: last.otherTerms,
            paymentTermId: last.paymentTermId,
            buyListing: buyL
              ? {
                  id: buyL.id,
                  referenceNumber: buyL.referenceNumber,
                  snapshot: buyL.snapshot,
                }
              : null,
            sellListing: sellL
              ? {
                  id: sellL.id,
                  referenceNumber: sellL.referenceNumber,
                  snapshot: sellL.snapshot,
                }
              : null,
          } as Prisma.InputJsonValue,
          ...(party === ImportTradeParty.BUYER
            ? { buyerConfirmedAt: now }
            : { sellerConfirmedAt: now }),
        },
      });
      await this.bumpListing(
        tx,
        fresh.buyListingId,
        ImportListingStatus.MATCHED,
      );
      await this.bumpListing(
        tx,
        fresh.sellListingId,
        ImportListingStatus.MATCHED,
      );
      await this.idempotency.record(
        tx,
        actor.userId,
        'NEGOTIATION_ACCEPT',
        key,
        id,
      );
      return deal.id;
    });

    const deal = await this.prisma.importDeal.findUniqueOrThrow({
      where: { id: dealId },
    });
    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.COUNTEROFFER_ACCEPTED,
      actorUserId: actor.userId,
      actorRole: this.actors.actorRole(actor, party),
      organizationId:
        party === ImportTradeParty.BUYER ? n.buyerOrgId : n.sellerOrgId,
      entityType: EntityOwnerType.IMPORT_NEGOTIATION,
      entityId: id,
      newData: {
        status: ImportNegotiationStatus.AGREED,
        dealId,
        dealReference: deal.referenceNumber,
      },
      metadata: {
        referenceNumber: n.referenceNumber,
        party,
        price: deal.price.toString(),
        quantity: deal.quantity.toString(),
        currencyCode: deal.currencyCode,
      },
    });
    const other = this.otherOrg(n, party);
    await this.notifier.notify({
      organizationId: other,
      event: IMPORT_NOTIFICATION_EVENTS.COUNTEROFFER_ACCEPTED,
      title: 'Import terms accepted',
      body: `Your terms in negotiation ${n.referenceNumber} were accepted.`,
      entityType: EntityOwnerType.IMPORT_NEGOTIATION,
      entityId: id,
      metadata: {
        negotiationId: id,
        referenceNumber: n.referenceNumber,
        dealId,
      },
    });
    await this.notifier.notify({
      organizationId: other,
      event: IMPORT_NOTIFICATION_EVENTS.DEAL_CONFIRMATION_REQUIRED,
      title: 'Confirm Import deal',
      body: `Deal ${deal.referenceNumber} is waiting for your confirmation.`,
      entityType: EntityOwnerType.IMPORT_DEAL,
      entityId: dealId,
      metadata: {
        dealId,
        referenceNumber: deal.referenceNumber,
        negotiationId: id,
      },
    });
    return this.get(user, id);
  }

  async reject(user: AuthenticatedUser, id: string, dto: NegotiationNoteDto) {
    return this.close(user, id, 'REJECT', dto.note);
  }

  async withdraw(user: AuthenticatedUser, id: string, dto: NegotiationNoteDto) {
    return this.close(user, id, 'WITHDRAW', dto.note);
  }

  private async close(
    user: AuthenticatedUser,
    id: string,
    kind: 'REJECT' | 'WITHDRAW',
    note?: string,
  ) {
    const actor = await this.actors.resolve(user);
    const { n, party } = await this.loadForParty(actor, id);
    this.assertOpen(n);
    if (kind === 'REJECT') this.assertMyTurn(n, party);

    await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.lockNegotiation(tx, id);
      const fresh = await tx.importNegotiation.findUniqueOrThrow({
        where: { id },
      });
      if (fresh.status !== ImportNegotiationStatus.OPEN) {
        throw new ImportException(
          'NEGOTIATION_NOT_ALLOWED',
          'The negotiation changed; refresh and try again.',
        );
      }
      await this.lifecycle.appendEvent(tx, id, {
        type:
          kind === 'REJECT'
            ? ImportNegotiationEventType.REJECTED
            : ImportNegotiationEventType.WITHDRAWN,
        actorParty: party,
        actorUserId: actor.userId,
        note: note?.trim() || null,
      });
      await tx.importNegotiation.update({
        where: { id },
        data: {
          status:
            kind === 'REJECT'
              ? ImportNegotiationStatus.REJECTED
              : ImportNegotiationStatus.WITHDRAWN,
          lastActorParty: party,
          closedAt: new Date(),
        },
      });
      if (fresh.matchId) {
        await tx.importMatch.updateMany({
          where: { id: fresh.matchId, status: ImportMatchStatus.NEGOTIATING },
          data: {
            status:
              kind === 'REJECT'
                ? ImportMatchStatus.DISMISSED
                : ImportMatchStatus.SUGGESTED,
          },
        });
      }
    });

    await this.audit.log({
      action:
        kind === 'REJECT'
          ? IMPORT_AUDIT_ACTIONS.COUNTEROFFER_REJECTED
          : IMPORT_AUDIT_ACTIONS.NEGOTIATION_WITHDRAWN,
      actorUserId: actor.userId,
      actorRole: this.actors.actorRole(actor, party),
      organizationId:
        party === ImportTradeParty.BUYER ? n.buyerOrgId : n.sellerOrgId,
      entityType: EntityOwnerType.IMPORT_NEGOTIATION,
      entityId: id,
      previousData: { status: ImportNegotiationStatus.OPEN },
      newData: { status: kind === 'REJECT' ? 'REJECTED' : 'WITHDRAWN' },
      metadata: {
        referenceNumber: n.referenceNumber,
        party,
        note: note ?? null,
      },
    });
    await this.notifier.notify({
      organizationId: this.otherOrg(n, party),
      event:
        kind === 'REJECT'
          ? IMPORT_NOTIFICATION_EVENTS.COUNTEROFFER_REJECTED
          : IMPORT_NOTIFICATION_EVENTS.NEGOTIATION_WITHDRAWN,
      title:
        kind === 'REJECT'
          ? 'Import offer rejected'
          : 'Import negotiation withdrawn',
      body: `Negotiation ${n.referenceNumber} was ${kind === 'REJECT' ? 'rejected' : 'withdrawn'} by the other party.`,
      entityType: EntityOwnerType.IMPORT_NEGOTIATION,
      entityId: id,
      metadata: { negotiationId: id, referenceNumber: n.referenceNumber },
    });
    return this.get(user, id);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  private partyScope(
    actor: ImportActor,
    as?: 'buyer' | 'seller',
  ): Prisma.ImportNegotiationWhereInput {
    const or: Prisma.ImportNegotiationWhereInput[] = [];
    if (actor.buyer && as !== 'seller')
      or.push({ buyerOrgId: actor.buyer.organizationId });
    if (actor.seller && as !== 'buyer')
      or.push({ sellerOrgId: actor.seller.organizationId });
    if (!or.length) throw new ImportException('IMPORT_PROFILE_REQUIRED');
    return { OR: or };
  }

  async list(user: AuthenticatedUser, query: ListNegotiationsQueryDto) {
    const actor = await this.actors.resolve(user);
    const where: Prisma.ImportNegotiationWhereInput = {
      AND: [
        this.partyScope(actor, query.as),
        query.status ? { status: query.status } : {},
        query.listingId
          ? {
              OR: [
                { buyListingId: query.listingId },
                { sellListingId: query.listingId },
              ],
            }
          : {},
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
      this.prisma.importNegotiation.findMany({
        where,
        include: NEGOTIATION_INCLUDE,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.importNegotiation.count({ where }),
    ]);
    const now = new Date();
    return {
      items: rows.map((n) => this.map(n, this.actors.partyFor(actor, n)!, now)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async get(user: AuthenticatedUser, id: string) {
    const actor = await this.actors.resolve(user);
    const { n, party } = await this.loadForParty(actor, id);
    const events = await this.prisma.importNegotiationEvent.findMany({
      where: { negotiationId: id },
      orderBy: { sequence: 'asc' },
    });
    const primary = await this.prisma.importListing.findUnique({
      where: { id: this.primaryListingId(n) },
      select: {
        incotermId: true,
        snapshot: true,
        currencyCode: true,
        priceUnit: true,
        quantityUnit: true,
      },
    });
    const snap = (primary?.snapshot ?? {}) as Partial<ListingSnapshot>;
    return {
      ...this.map(n, party),
      fixedTerms: {
        currencyCode: primary?.currencyCode ?? null,
        priceUnit: primary?.priceUnit ?? null,
        quantityUnit: primary?.quantityUnit ?? null,
        incoterm: snap.incoterm?.code ?? null,
        priceBasis: snap.priceBasisPort?.name ?? null,
      },
      events: events.map(mapEvent),
      allowedActions:
        n.status === ImportNegotiationStatus.OPEN
          ? n.lastActorParty === party
            ? ['WITHDRAW']
            : ['COUNTER', 'ACCEPT', 'REJECT', 'WITHDRAW']
          : [],
    };
  }
}
