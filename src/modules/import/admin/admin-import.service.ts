import { Injectable } from '@nestjs/common';
import {
  EntityOwnerType,
  ImportDealStatus,
  ImportListingStatus,
  ImportNegotiationStatus,
  ImportSide,
  ImportTradeParty,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../../master-data/common/pagination.js';
import {
  IMPORT_AUDIT_ACTIONS,
  ImportAuditService,
} from '../common/import-audit.service.js';
import {
  ImportLifecycleService,
  type LifecycleActor,
} from '../common/import-lifecycle.service.js';
import { ImportNotifierService } from '../common/import-notifier.service.js';
import { ImportSettingsService } from '../common/import-settings.service.js';
import { mapDeal, DEAL_INCLUDE } from '../deals/import-deals.service.js';
import { decimalString } from '../domain/import-decimal.js';
import {
  IMPORT_NOTIFICATION_EVENTS,
  MATCH_CRITERIA,
  OPEN_LISTING_STATUSES,
} from '../domain/import.constants.js';
import { ImportException } from '../domain/import.errors.js';
import { normalizeWeights } from '../domain/import-matching.js';
import {
  assertTransition,
  canTransition,
} from '../domain/import-status.machine.js';
import {
  LISTING_INCLUDE,
  mapListing,
} from '../listings/import-listing.mapper.js';
import { ImportMatchingService } from '../matching/import-matching.service.js';
import { DocumentsCoreService } from '../../documents/services/documents-core.service.js';
import { ImportShipmentsService } from '../shipments/import-shipments.service.js';
import {
  IMPORT_AUDIT_ENTITY_TYPES,
  type AdminDealsQueryDto,
  type AdminImportAuditQueryDto,
  type AdminImportDocumentsQueryDto,
  type AdminListingsQueryDto,
  type AdminMatchesQueryDto,
  type AdminNegotiationsQueryDto,
  type UpdateImportSettingsDto,
} from './dto/admin-import.dto.js';

export type AdminActor = { userId: string; role: string };

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

type PersonRow = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

const personName = (p: PersonRow) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ') ||
  p.email ||
  'Unknown user';

const AUDIT_ACTOR_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} satisfies Prisma.UserSelect;

type AuditRow = Prisma.AuditLogGetPayload<{
  include: { actor: { select: typeof AUDIT_ACTOR_SELECT } };
}>;

/** Reference / party / listing search shared by negotiations and deals. */
function tradeSearch(search: string) {
  const contains = { contains: search, mode: Prisma.QueryMode.insensitive };
  return [
    { referenceNumber: contains },
    { buyerOrg: { name: contains } },
    { buyerOrg: { legalName: contains } },
    { sellerOrg: { name: contains } },
    { sellerOrg: { legalName: contains } },
    { buyListing: { referenceNumber: contains } },
    { sellListing: { referenceNumber: contains } },
  ];
}

function mapAuditRow(a: AuditRow) {
  return {
    id: a.id,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    actor: a.actor ? { id: a.actor.id, name: personName(a.actor) } : null,
    metadata: a.metadata,
    previousData: a.previousData,
    newData: a.newData,
    createdAt: a.createdAt,
  };
}

@Injectable()
export class AdminImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ImportSettingsService,
    private readonly audit: ImportAuditService,
    private readonly lifecycle: ImportLifecycleService,
    private readonly notifier: ImportNotifierService,
    private readonly matching: ImportMatchingService,
    private readonly documents: DocumentsCoreService,
    private readonly shipments: ImportShipmentsService,
  ) {}

  private lifecycleActor(actor: AdminActor): LifecycleActor {
    return {
      userId: actor.userId,
      role: actor.role,
      party: ImportTradeParty.ADMIN,
    };
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  async getSettings() {
    return { ...(await this.settings.get()), criteria: MATCH_CRITERIA };
  }

  async updateSettings(dto: UpdateImportSettingsDto, actor: AdminActor) {
    if (dto.matchWeights) {
      const unknown = Object.keys(dto.matchWeights).filter(
        (k) => !(MATCH_CRITERIA as readonly string[]).includes(k),
      );
      const invalid = Object.entries(dto.matchWeights).filter(
        ([, v]) =>
          typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000,
      );
      if (unknown.length || invalid.length) {
        throw new ImportException(
          'IMPORT_VALIDATION_FAILED',
          'Match weights must be known criteria with values 0-1000.',
          {
            unknownCriteria: unknown,
            invalidCriteria: invalid.map(([k]) => k),
          },
        );
      }
      if (Object.values(dto.matchWeights).every((v) => v === 0)) {
        throw new ImportException(
          'IMPORT_VALIDATION_FAILED',
          'At least one match weight must be greater than 0.',
        );
      }
    }
    const before = await this.settings.get();
    const { matchWeights, ...rest } = dto;
    const after = await this.settings.update(
      {
        ...rest,
        ...(matchWeights
          ? {
              matchWeights: normalizeWeights({
                ...before.matchWeights,
                ...matchWeights,
              }),
            }
          : {}),
      },
      actor.userId,
    );
    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.SETTINGS_UPDATED,
      actorUserId: actor.userId,
      actorRole: actor.role,
      entityType: EntityOwnerType.IMPORT_MASTER,
      previousData: before,
      newData: after,
      metadata: { entity: 'settings' },
    });
    return { ...after, criteria: MATCH_CRITERIA };
  }

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------

  async dashboard() {
    const now = new Date();
    const live = {
      status: { in: OPEN_LISTING_STATUSES },
      deletedAt: null,
      validUntil: { gt: now },
    };
    const [
      byStatus,
      activeBuy,
      activeSell,
      openNegotiations,
      agreedNegotiations,
      dealsByStatus,
      volume,
      value,
      topProducts,
      recent,
      shipmentsByStatus,
    ] = await Promise.all([
      this.prisma.importListing.groupBy({
        by: ['side', 'status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.importListing.count({
        where: { ...live, side: ImportSide.BUY },
      }),
      this.prisma.importListing.count({
        where: { ...live, side: ImportSide.SELL },
      }),
      this.prisma.importNegotiation.count({
        where: { status: ImportNegotiationStatus.OPEN },
      }),
      this.prisma.importNegotiation.count({
        where: { status: ImportNegotiationStatus.AGREED },
      }),
      this.prisma.importDeal.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<Array<{ metric_tons: Prisma.Decimal | null }>>`
        SELECT SUM(CASE quantity_unit WHEN 'MT' THEN quantity WHEN 'KG' THEN quantity / 1000 END) AS metric_tons
        FROM import_deals WHERE status IN ('CONFIRMED', 'PARTIALLY_FULFILLED', 'FULFILLED')`,
      this.prisma.$queryRaw<
        Array<{ currency_code: string; value: Prisma.Decimal; deals: bigint }>
      >`
        SELECT currency_code,
               SUM(price * CASE WHEN price_unit = quantity_unit THEN quantity
                                WHEN price_unit = 'MT' AND quantity_unit = 'KG' THEN quantity / 1000
                                WHEN price_unit = 'KG' AND quantity_unit = 'MT' THEN quantity * 1000 END) AS value,
               COUNT(*) AS deals
        FROM import_deals WHERE status IN ('CONFIRMED', 'PARTIALLY_FULFILLED', 'FULFILLED')
        GROUP BY currency_code ORDER BY currency_code`,
      this.prisma.importListing.groupBy({
        by: ['categoryId'],
        where: { ...live, categoryId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { categoryId: 'desc' } },
        take: 5,
      }),
      this.prisma.importListing.findMany({
        where: { deletedAt: null, status: { not: ImportListingStatus.DRAFT } },
        orderBy: { publishedAt: 'desc' },
        take: 8,
        include: LISTING_INCLUDE,
      }),
      this.prisma.importShipment.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    const categories = await this.prisma.gradeCategory.findMany({
      where: {
        id: { in: topProducts.map((t) => t.categoryId!).filter(Boolean) },
      },
      select: { id: true, name: true, displayName: true },
    });
    const catName = new Map(
      categories.map((c) => [c.id, c.displayName ?? c.name]),
    );
    const listingCounts: Record<string, Record<string, number>> = {
      BUY: {},
      SELL: {},
    };
    for (const g of byStatus) listingCounts[g.side][g.status] = g._count._all;
    const deals = Object.fromEntries(
      dealsByStatus.map((g) => [g.status, g._count._all]),
    );
    const shipments: Record<string, number> = Object.fromEntries(
      shipmentsByStatus.map((g) => [g.status, g._count._all]),
    );
    const sum = (counts: Record<string, number>) =>
      Object.values(counts).reduce((a, b) => a + b, 0);

    return {
      serverTime: now,
      activeBuyRequests: activeBuy,
      activeSellOffers: activeSell,
      openNegotiations,
      agreedNegotiations,
      matchedListings:
        (listingCounts.BUY.MATCHED ?? 0) + (listingCounts.SELL.MATCHED ?? 0),
      dealsPendingConfirmation: deals.PENDING_CONFIRMATION ?? 0,
      dealsConfirmed:
        (deals.CONFIRMED ?? 0) +
        (deals.PARTIALLY_FULFILLED ?? 0) +
        (deals.FULFILLED ?? 0),
      expiredListings:
        (listingCounts.BUY.EXPIRED ?? 0) + (listingCounts.SELL.EXPIRED ?? 0),
      cancelledListings:
        (listingCounts.BUY.CANCELLED ?? 0) +
        (listingCounts.SELL.CANCELLED ?? 0),
      totalBuyRequests: sum(listingCounts.BUY) - (listingCounts.BUY.DRAFT ?? 0),
      totalSellOffers:
        sum(listingCounts.SELL) - (listingCounts.SELL.DRAFT ?? 0),
      dealsCancelled: deals.CANCELLED ?? 0,
      shipmentsInTransit:
        (shipments.SHIPPED ?? 0) +
        (shipments.IN_TRANSIT ?? 0) +
        (shipments.ARRIVED ?? 0) +
        (shipments.CUSTOMS_CLEARANCE ?? 0) +
        (shipments.OUT_FOR_DELIVERY ?? 0),
      shipmentsBooked: shipments.BOOKED ?? 0,
      shipmentsDelivered: shipments.DELIVERED ?? 0,
      shipmentExceptions: shipments.EXCEPTION ?? 0,
      shipmentsByStatus: shipments,
      confirmedVolumeMt: decimalString(volume[0]?.metric_tons ?? null) ?? '0',
      confirmedValueByCurrency: value.map((v) => ({
        currencyCode: v.currency_code,
        value: decimalString(v.value),
        deals: Number(v.deals),
      })),
      listingsBySideAndStatus: listingCounts,
      dealsByStatus: deals,
      topProducts: topProducts.map((t) => ({
        categoryId: t.categoryId,
        name: catName.get(t.categoryId!) ?? null,
        activeListings: t._count._all,
      })),
      recentListings: recent.map((l) => mapListing(l, 'admin', { now })),
    };
  }

  // ---------------------------------------------------------------------------
  // Listings
  // ---------------------------------------------------------------------------

  async listListings(query: AdminListingsQueryDto) {
    const and: Prisma.ImportListingWhereInput[] = [
      { deletedAt: null },
      {
        side: query.side,
        categoryId: query.categoryId,
        gradeId: query.gradeId,
        originCountryId: query.originCountryId,
        incotermId: query.incotermId,
        polId: query.polId,
        podId: query.podId,
        ownerOrgId: query.ownerOrgId,
      },
    ];
    if (query.status?.length) and.push({ status: { in: query.status } });
    if (query.currencyCode)
      and.push({ currencyCode: query.currencyCode.toUpperCase() });
    if (query.createdFrom || query.createdTo) {
      and.push({
        createdAt: {
          ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
          ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
        },
      });
    }
    const search = resolveSearch(query);
    if (search) {
      const contains = { contains: search, mode: Prisma.QueryMode.insensitive };
      and.push({
        OR: [
          { referenceNumber: contains },
          { customGradeName: contains },
          { grade: { name: contains } },
          { category: { name: contains } },
          { brand: { name: contains } },
          { ownerOrg: { name: contains } },
        ],
      });
    }
    const where: Prisma.ImportListingWhereInput = { AND: and };
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const [rows, total] = await Promise.all([
      this.prisma.importListing.findMany({
        where,
        include: {
          ...LISTING_INCLUDE,
          ownerOrg: { select: { id: true, name: true, legalName: true } },
        },
        orderBy: [
          { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
          { id: 'asc' },
        ],
        skip,
        take,
      }),
      this.prisma.importListing.count({ where }),
    ]);
    const now = new Date();
    return {
      items: rows.map((r) => ({
        ...mapListing(r, 'admin', { now }),
        ownerOrg: {
          id: r.ownerOrg.id,
          name: r.ownerOrg.legalName ?? r.ownerOrg.name,
        },
      })),
      meta: paginationMeta(page, limit, total),
    };
  }

  async listingDetail(id: string) {
    const listing = await this.prisma.importListing.findUnique({
      where: { id },
      include: {
        ...LISTING_INCLUDE,
        ownerOrg: {
          select: {
            id: true,
            name: true,
            legalName: true,
            type: true,
            email: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    });
    if (!listing) throw new ImportException('IMPORT_NOT_FOUND');

    const [negotiations, matches, deals, documents] = await Promise.all([
      this.prisma.importNegotiation.findMany({
        where: { OR: [{ buyListingId: id }, { sellListingId: id }] },
        include: {
          events: { orderBy: { sequence: 'asc' } },
          buyerOrg: { select: { id: true, name: true } },
          sellerOrg: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.importMatch.findMany({
        where: { OR: [{ buyListingId: id }, { sellListingId: id }] },
        include: {
          buyListing: {
            select: { id: true, referenceNumber: true, status: true },
          },
          sellListing: {
            select: { id: true, referenceNumber: true, status: true },
          },
        },
        orderBy: { score: 'desc' },
        take: 100,
      }),
      this.prisma.importDeal.findMany({
        where: { OR: [{ buyListingId: id }, { sellListingId: id }] },
        include: DEAL_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.document.findMany({
        where: {
          ownerType: EntityOwnerType.IMPORT_LISTING,
          ownerId: id,
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          documentNumber: true,
          category: true,
          fileName: true,
          mimeType: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);
    const auditTrail = await this.auditTrailFor([
      id,
      ...negotiations.map((n) => n.id),
      ...deals.map((d) => d.id),
    ]);

    return {
      ...mapListing(listing, 'admin'),
      ownerOrg: listing.ownerOrg,
      createdBy: listing.createdBy,
      snapshot: listing.snapshot,
      negotiations: negotiations.map((n) => ({
        id: n.id,
        referenceNumber: n.referenceNumber,
        status: n.status,
        buyerOrg: n.buyerOrg,
        sellerOrg: n.sellerOrg,
        initiatedBy: n.initiatedBy,
        lastActorParty: n.lastActorParty,
        roundCount: n.roundCount,
        expiresAt: n.expiresAt,
        agreedAt: n.agreedAt,
        closedAt: n.closedAt,
        createdAt: n.createdAt,
        events: n.events.map((e) => ({
          sequence: e.sequence,
          type: e.type,
          actorParty: e.actorParty,
          actorUserId: e.actorUserId,
          price: decimalString(e.price),
          currencyCode: e.currencyCode,
          priceUnit: e.priceUnit,
          quantity: decimalString(e.quantity),
          quantityUnit: e.quantityUnit,
          incotermCode: e.incotermCode,
          paymentTermName: e.paymentTermName,
          esd: dateOnly(e.esd),
          lsd: dateOnly(e.lsd),
          note: e.note,
          createdAt: e.createdAt,
        })),
      })),
      matches: matches.map((m) => ({
        id: m.id,
        status: m.status,
        matchScore: Number(m.score),
        matchedCriteria: m.matchedCriteria,
        unmatchedCriteria: m.unmatchedCriteria,
        evidence: m.evidence,
        algorithmVersion: m.algorithmVersion,
        computedAt: m.computedAt,
        buyListing: m.buyListing,
        sellListing: m.sellListing,
      })),
      deals: deals.map((d) => mapDeal(d, 'ADMIN')),
      documents,
      auditTrail,
    };
  }

  async setListingStatus(
    id: string,
    status: ImportListingStatus,
    reason: string | undefined,
    actor: AdminActor,
  ) {
    const listing = await this.prisma.importListing.findFirst({
      where: { id, deletedAt: null },
    });
    if (!listing) throw new ImportException('IMPORT_NOT_FOUND');

    if (
      status === ImportListingStatus.CANCELLED ||
      status === ImportListingStatus.EXPIRED
    ) {
      assertTransition(listing.status, status);
      await this.lifecycle.endListing(
        id,
        status === ImportListingStatus.CANCELLED ? 'CANCELLED' : 'EXPIRED',
        this.lifecycleActor(actor),
        { reason: reason ?? 'Closed by Admin' },
      );
    } else {
      assertTransition(listing.status, status);
      if (
        status === ImportListingStatus.PUBLISHED &&
        listing.validUntil &&
        listing.validUntil <= new Date()
      ) {
        throw new ImportException('OFFER_EXPIRED');
      }
      const res = await this.prisma.importListing.updateMany({
        where: { id, status: listing.status },
        data: {
          status,
          version: { increment: 1 },
          pausedAt: status === ImportListingStatus.PAUSED ? new Date() : null,
        },
      });
      if (res.count === 0) throw new ImportException('IMPORT_DRAFT_CONFLICT');
      await this.matching.recomputeSafely(id);
    }

    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.STATUS_CHANGED_BY_ADMIN,
      actorUserId: actor.userId,
      actorRole: actor.role,
      organizationId: listing.ownerOrgId,
      entityType: EntityOwnerType.IMPORT_LISTING,
      entityId: id,
      previousData: { status: listing.status },
      newData: { status },
      metadata: {
        referenceNumber: listing.referenceNumber,
        reason: reason ?? null,
      },
    });
    await this.notifier.notify({
      organizationId: listing.ownerOrgId,
      event:
        status === ImportListingStatus.EXPIRED
          ? IMPORT_NOTIFICATION_EVENTS.EXPIRED
          : IMPORT_NOTIFICATION_EVENTS.NEGOTIATION_WITHDRAWN,
      title: 'Import listing updated by Admin',
      body: `${listing.referenceNumber} is now ${status.toLowerCase()}${reason ? `: ${reason}` : '.'}`,
      entityType: EntityOwnerType.IMPORT_LISTING,
      entityId: id,
      metadata: {
        listingId: id,
        referenceNumber: listing.referenceNumber,
        status,
      },
    });
    return this.listingDetail(id);
  }

  async rematch(id: string, actor: AdminActor) {
    const listing = await this.prisma.importListing.findFirst({
      where: { id, deletedAt: null },
    });
    if (!listing) throw new ImportException('IMPORT_NOT_FOUND');
    const result = await this.matching.recomputeForListing(id);
    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.MATCHES_RECOMPUTED,
      actorUserId: actor.userId,
      actorRole: actor.role,
      organizationId: listing.ownerOrgId,
      entityType: EntityOwnerType.IMPORT_LISTING,
      entityId: id,
      newData: result,
      metadata: { referenceNumber: listing.referenceNumber },
    });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Negotiations, deals, matches
  // ---------------------------------------------------------------------------

  async listNegotiations(query: AdminNegotiationsQueryDto) {
    const search = resolveSearch(query);
    const where: Prisma.ImportNegotiationWhereInput = {
      AND: [
        query.status ? { status: query.status } : {},
        query.listingId
          ? {
              OR: [
                { buyListingId: query.listingId },
                { sellListingId: query.listingId },
              ],
            }
          : {},
        search ? { OR: tradeSearch(search) } : {},
      ],
    };
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const [rows, total] = await Promise.all([
      this.prisma.importNegotiation.findMany({
        where,
        include: {
          buyerOrg: { select: { id: true, name: true } },
          sellerOrg: { select: { id: true, name: true } },
          buyListing: { select: { id: true, referenceNumber: true } },
          sellListing: { select: { id: true, referenceNumber: true } },
          events: { orderBy: { sequence: 'desc' }, take: 1 },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.importNegotiation.count({ where }),
    ]);
    return {
      items: rows.map((n) => ({
        id: n.id,
        referenceNumber: n.referenceNumber,
        status: n.status,
        buyerOrg: n.buyerOrg,
        sellerOrg: n.sellerOrg,
        buyListing: n.buyListing,
        sellListing: n.sellListing,
        roundCount: n.roundCount,
        lastActorParty: n.lastActorParty,
        expiresAt: n.expiresAt,
        latestPrice: decimalString(n.events[0]?.price ?? null),
        latestQuantity: decimalString(n.events[0]?.quantity ?? null),
        currencyCode: n.events[0]?.currencyCode ?? null,
        updatedAt: n.updatedAt,
      })),
      meta: paginationMeta(page, limit, total),
    };
  }

  async negotiationDetail(id: string) {
    const n = await this.prisma.importNegotiation.findUnique({
      where: { id },
      include: {
        events: { orderBy: { sequence: 'asc' } },
        buyerOrg: { select: { id: true, name: true } },
        sellerOrg: { select: { id: true, name: true } },
        buyListing: {
          select: { id: true, referenceNumber: true, status: true },
        },
        sellListing: {
          select: { id: true, referenceNumber: true, status: true },
        },
        deal: { include: DEAL_INCLUDE },
      },
    });
    if (!n) throw new ImportException('NEGOTIATION_NOT_FOUND');
    return {
      ...n,
      events: n.events.map((e) => ({
        ...e,
        price: decimalString(e.price),
        quantity: decimalString(e.quantity),
        moq: decimalString(e.moq),
        esd: dateOnly(e.esd),
        lsd: dateOnly(e.lsd),
      })),
      deal: n.deal ? mapDeal(n.deal, 'ADMIN') : null,
    };
  }

  async listDeals(query: AdminDealsQueryDto) {
    const search = resolveSearch(query);
    const where: Prisma.ImportDealWhereInput = {
      AND: [
        query.status ? { status: query.status } : {},
        search ? { OR: tradeSearch(search) } : {},
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
      items: rows.map((d) => mapDeal(d, 'ADMIN')),
      meta: paginationMeta(page, limit, total),
    };
  }

  /** Deal + agreed-terms history, both listings' documents and the full audit trail. */
  async dealDetail(id: string) {
    const deal = await this.prisma.importDeal.findUnique({
      where: { id },
      include: {
        ...DEAL_INCLUDE,
        negotiation: {
          select: {
            id: true,
            referenceNumber: true,
            status: true,
            roundCount: true,
            createdAt: true,
            agreedAt: true,
            events: { orderBy: { sequence: 'asc' } },
          },
        },
      },
    });
    if (!deal) throw new ImportException('DEAL_NOT_FOUND');
    const listingIds = [deal.buyListingId, deal.sellListingId].filter(
      (v): v is string => Boolean(v),
    );
    const shipments = await this.shipments.forDeal(id, 'ADMIN');
    const [documents, auditTrail] = await Promise.all([
      this.findDocuments({
        ownerType: EntityOwnerType.IMPORT_LISTING,
        ownerId: { in: listingIds },
        deletedAt: null,
      }),
      this.auditTrailFor([
        id,
        deal.negotiationId,
        ...listingIds,
        ...shipments.map((s) => s.id),
      ]),
    ]);
    const n = deal.negotiation;
    return {
      ...mapDeal(
        {
          ...deal,
          negotiation: { id: n.id, referenceNumber: n.referenceNumber },
        },
        'ADMIN',
      ),
      negotiationSummary: {
        id: n.id,
        referenceNumber: n.referenceNumber,
        status: n.status,
        roundCount: n.roundCount,
        createdAt: n.createdAt,
        agreedAt: n.agreedAt,
      },
      timeline: n.events.map((e) => ({
        sequence: e.sequence,
        type: e.type,
        actorParty: e.actorParty,
        price: decimalString(e.price),
        currencyCode: e.currencyCode,
        priceUnit: e.priceUnit,
        quantity: decimalString(e.quantity),
        quantityUnit: e.quantityUnit,
        incotermCode: e.incotermCode,
        paymentTermName: e.paymentTermName,
        esd: dateOnly(e.esd),
        lsd: dateOnly(e.lsd),
        note: e.note,
        createdAt: e.createdAt,
      })),
      shipments,
      documents,
      auditTrail,
    };
  }

  /** Shipment with its full audit trail (who changed what, from which side). */
  async shipmentDetail(id: string) {
    const shipment = await this.shipments.adminGet(id);
    return {
      ...shipment,
      auditTrail: await this.auditTrailFor([id]),
    };
  }

  // ---------------------------------------------------------------------------
  // Documents & audit
  // ---------------------------------------------------------------------------

  private async findDocuments(
    where: Prisma.DocumentWhereInput,
    page?: { skip: number; take: number },
  ) {
    const rows = await this.prisma.document.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: page?.skip ?? 0,
      take: page?.take ?? 200,
      include: {
        uploadedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        organization: { select: { id: true, name: true, legalName: true } },
      },
    });
    const listings = await this.prisma.importListing.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.ownerId))] } },
      select: { id: true, referenceNumber: true, side: true, status: true },
    });
    const byId = new Map(listings.map((l) => [l.id, l]));
    return rows.map((d) => {
      const mapped = this.documents.mapDocument(d);
      return {
        id: d.id,
        documentNumber: d.documentNumber,
        category: d.category,
        fileName: mapped.originalFileName,
        mimeType: d.mimeType,
        fileSizeBytes: mapped.fileSizeBytes,
        status: d.status,
        version: d.version,
        previousDocumentId: d.previousDocumentId,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        uploadedBy: d.uploadedBy
          ? { id: d.uploadedBy.id, name: personName(d.uploadedBy) }
          : null,
        organization: d.organization
          ? {
              id: d.organization.id,
              name: d.organization.legalName ?? d.organization.name,
            }
          : null,
        listing: byId.get(d.ownerId) ?? null,
      };
    });
  }

  async listDocuments(query: AdminImportDocumentsQueryDto) {
    const and: Prisma.DocumentWhereInput[] = [
      { ownerType: EntityOwnerType.IMPORT_LISTING, deletedAt: null },
    ];
    if (query.listingId) and.push({ ownerId: query.listingId });
    if (query.dealId) {
      const deal = await this.prisma.importDeal.findUnique({
        where: { id: query.dealId },
        select: { buyListingId: true, sellListingId: true },
      });
      if (!deal) throw new ImportException('DEAL_NOT_FOUND');
      and.push({
        ownerId: {
          in: [deal.buyListingId, deal.sellListingId].filter((v): v is string =>
            Boolean(v),
          ),
        },
      });
    }
    if (query.side) {
      const ids = await this.prisma.importListing.findMany({
        where: {
          side: query.side,
          ...(query.ownerOrgId ? { ownerOrgId: query.ownerOrgId } : {}),
        },
        select: { id: true },
      });
      and.push({ ownerId: { in: ids.map((l) => l.id) } });
    }
    if (query.ownerOrgId) and.push({ organizationId: query.ownerOrgId });
    if (query.category) and.push({ category: query.category });
    if (query.status) and.push({ status: query.status });
    if (query.createdFrom || query.createdTo) {
      and.push({
        createdAt: {
          ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
          ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
        },
      });
    }
    const search = resolveSearch(query);
    if (search) {
      const contains = { contains: search, mode: Prisma.QueryMode.insensitive };
      const refs = await this.prisma.importListing.findMany({
        where: { referenceNumber: contains },
        select: { id: true },
        take: 200,
      });
      and.push({
        OR: [
          { fileName: contains },
          { originalFileName: contains },
          { documentNumber: contains },
          { ownerId: { in: refs.map((r) => r.id) } },
        ],
      });
    }
    const where: Prisma.DocumentWhereInput = { AND: and };
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const [items, total] = await Promise.all([
      this.findDocuments(where, { skip, take }),
      this.prisma.document.count({ where }),
    ]);
    return { items, meta: paginationMeta(page, limit, total) };
  }

  async downloadDocument(
    id: string,
    disposition: 'inline' | 'attachment' | undefined,
    actor: AdminActor,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id, ownerType: EntityOwnerType.IMPORT_LISTING, deletedAt: null },
      select: { id: true, ownerId: true, organizationId: true, category: true },
    });
    if (!doc) throw new ImportException('IMPORT_NOT_FOUND');
    const result = await this.documents.download(
      id,
      { ownerType: EntityOwnerType.IMPORT_LISTING, ownerId: doc.ownerId },
      { disposition: disposition ?? 'inline', verifyExists: true },
    );
    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.DOCUMENT_ACCESSED_BY_ADMIN,
      actorUserId: actor.userId,
      actorRole: actor.role,
      organizationId: doc.organizationId,
      entityType: EntityOwnerType.IMPORT_LISTING,
      entityId: doc.ownerId,
      metadata: {
        documentId: id,
        category: doc.category,
        disposition: disposition ?? 'inline',
      },
    });
    return result;
  }

  private async auditTrailFor(entityIds: string[]) {
    const rows = await this.prisma.auditLog.findMany({
      where: { entityId: { in: entityIds } },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: AUDIT_ACTOR_SELECT } },
      take: 500,
    });
    return rows.map(mapAuditRow);
  }

  async listAuditLogs(query: AdminImportAuditQueryDto) {
    const and: Prisma.AuditLogWhereInput[] = [
      {
        entityType: query.entityType
          ? query.entityType
          : { in: [...IMPORT_AUDIT_ENTITY_TYPES] },
      },
    ];
    if (query.entityId) and.push({ entityId: query.entityId });
    if (query.actorUserId) and.push({ actorUserId: query.actorUserId });
    if (query.organizationId)
      and.push({ organizationId: query.organizationId });
    if (query.action) and.push({ action: query.action });
    if (query.createdFrom || query.createdTo) {
      and.push({
        createdAt: {
          ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
          ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
        },
      });
    }
    const search = resolveSearch(query);
    if (search) {
      const contains = { contains: search, mode: Prisma.QueryMode.insensitive };
      const [listings, negotiations, deals, shipmentHits] = await Promise.all([
        this.prisma.importListing.findMany({
          where: { referenceNumber: contains },
          select: { id: true },
          take: 100,
        }),
        this.prisma.importNegotiation.findMany({
          where: { referenceNumber: contains },
          select: { id: true },
          take: 100,
        }),
        this.prisma.importDeal.findMany({
          where: { referenceNumber: contains },
          select: { id: true },
          take: 100,
        }),
        this.prisma.importShipment.findMany({
          where: { referenceNumber: contains },
          select: { id: true },
          take: 100,
        }),
      ]);
      and.push({
        OR: [
          { action: contains },
          {
            entityId: {
              in: [...listings, ...negotiations, ...deals, ...shipmentHits].map(
                (r) => r.id,
              ),
            },
          },
        ],
      });
    }
    const where: Prisma.AuditLogWhereInput = { AND: and };
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        include: {
          actor: { select: AUDIT_ACTOR_SELECT },
          organization: { select: { id: true, name: true, legalName: true } },
        },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const idsOf = (type: EntityOwnerType) => [
      ...new Set(
        rows
          .filter((r) => r.entityType === type && r.entityId)
          .map((r) => r.entityId!),
      ),
    ];
    const [listings, negotiations, deals, shipmentRefs] = await Promise.all([
      this.prisma.importListing.findMany({
        where: { id: { in: idsOf(EntityOwnerType.IMPORT_LISTING) } },
        select: { id: true, referenceNumber: true, side: true },
      }),
      this.prisma.importNegotiation.findMany({
        where: { id: { in: idsOf(EntityOwnerType.IMPORT_NEGOTIATION) } },
        select: { id: true, referenceNumber: true },
      }),
      this.prisma.importDeal.findMany({
        where: { id: { in: idsOf(EntityOwnerType.IMPORT_DEAL) } },
        select: { id: true, referenceNumber: true },
      }),
      this.prisma.importShipment.findMany({
        where: { id: { in: idsOf(EntityOwnerType.IMPORT_SHIPMENT) } },
        select: { id: true, referenceNumber: true },
      }),
    ]);
    const refs = new Map<
      string,
      { referenceNumber: string | null; side?: ImportSide }
    >();
    for (const l of listings)
      refs.set(l.id, { referenceNumber: l.referenceNumber, side: l.side });
    for (const n of negotiations)
      refs.set(n.id, { referenceNumber: n.referenceNumber });
    for (const d of deals)
      refs.set(d.id, { referenceNumber: d.referenceNumber });
    for (const sh of shipmentRefs)
      refs.set(sh.id, { referenceNumber: sh.referenceNumber });

    return {
      items: rows.map((r) => ({
        ...mapAuditRow(r),
        organization: r.organization
          ? {
              id: r.organization.id,
              name: r.organization.legalName ?? r.organization.name,
            }
          : null,
        entityReference: r.entityId
          ? (refs.get(r.entityId)?.referenceNumber ?? null)
          : null,
        listingSide: r.entityId ? (refs.get(r.entityId)?.side ?? null) : null,
      })),
      meta: paginationMeta(page, limit, total),
    };
  }

  async setDealStatus(
    id: string,
    status: ImportDealStatus,
    reason: string | undefined,
    actor: AdminActor,
  ) {
    const deal = await this.prisma.importDeal.findUnique({ where: { id } });
    if (!deal) throw new ImportException('DEAL_NOT_FOUND');
    const allowed: Record<ImportDealStatus, ImportDealStatus[]> = {
      PENDING_CONFIRMATION: [ImportDealStatus.CANCELLED],
      CONFIRMED: [
        ImportDealStatus.PARTIALLY_FULFILLED,
        ImportDealStatus.FULFILLED,
        ImportDealStatus.CANCELLED,
      ],
      PARTIALLY_FULFILLED: [
        ImportDealStatus.FULFILLED,
        ImportDealStatus.CANCELLED,
      ],
      FULFILLED: [],
      CANCELLED: [],
    };
    if (!allowed[deal.status].includes(status)) {
      throw new ImportException('IMPORT_INVALID_STATUS_TRANSITION', undefined, {
        from: deal.status,
        to: status,
        allowed: allowed[deal.status],
      });
    }

    const listingTarget: ImportListingStatus | null =
      status === ImportDealStatus.FULFILLED
        ? ImportListingStatus.FULFILLED
        : status === ImportDealStatus.PARTIALLY_FULFILLED
          ? ImportListingStatus.PARTIALLY_FULFILLED
          : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.importDeal.update({
        where: { id },
        data: {
          status,
          ...(status === ImportDealStatus.CANCELLED
            ? { cancelledAt: new Date() }
            : {}),
        },
      });
      for (const listingId of [deal.buyListingId, deal.sellListingId]) {
        if (!listingId) continue;
        const l = await tx.importListing.findUnique({
          where: { id: listingId },
          select: { status: true },
        });
        if (!l) continue;
        // A cancelled pending deal re-opens its listings for negotiation.
        const target =
          listingTarget ??
          (l.status === ImportListingStatus.MATCHED
            ? ImportListingStatus.NEGOTIATION
            : null);
        if (target && canTransition(l.status, target)) {
          await tx.importListing.update({
            where: { id: listingId },
            data: { status: target },
          });
        }
      }
    });

    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.DEAL_STATUS_CHANGED_BY_ADMIN,
      actorUserId: actor.userId,
      actorRole: actor.role,
      organizationId: deal.buyerOrgId,
      entityType: EntityOwnerType.IMPORT_DEAL,
      entityId: id,
      previousData: { status: deal.status },
      newData: { status },
      metadata: {
        referenceNumber: deal.referenceNumber,
        reason: reason ?? null,
      },
    });
    for (const org of [deal.buyerOrgId, deal.sellerOrgId]) {
      await this.notifier.notify({
        organizationId: org,
        event: IMPORT_NOTIFICATION_EVENTS.DEAL_CONFIRMED,
        title: 'Import deal updated',
        body: `Deal ${deal.referenceNumber} is now ${status.toLowerCase().replace(/_/g, ' ')}${reason ? `: ${reason}` : '.'}`,
        entityType: EntityOwnerType.IMPORT_DEAL,
        entityId: id,
        metadata: { dealId: id, referenceNumber: deal.referenceNumber, status },
      });
    }
    return this.dealDetail(id);
  }

  async listMatches(query: AdminMatchesQueryDto) {
    const where: Prisma.ImportMatchWhereInput = {
      ...(query.minScore !== undefined
        ? { score: { gte: query.minScore } }
        : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const [rows, total] = await Promise.all([
      this.prisma.importMatch.findMany({
        where,
        include: {
          buyListing: {
            select: {
              id: true,
              referenceNumber: true,
              status: true,
              snapshot: true,
            },
          },
          sellListing: {
            select: {
              id: true,
              referenceNumber: true,
              status: true,
              snapshot: true,
            },
          },
        },
        orderBy: [{ computedAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.importMatch.count({ where }),
    ]);
    return {
      items: rows.map((m) => ({
        id: m.id,
        status: m.status,
        matchScore: Number(m.score),
        matchedCriteria: m.matchedCriteria,
        unmatchedCriteria: m.unmatchedCriteria,
        algorithmVersion: m.algorithmVersion,
        computedAt: m.computedAt,
        buyListing: {
          id: m.buyListing.id,
          referenceNumber: m.buyListing.referenceNumber,
          status: m.buyListing.status,
        },
        sellListing: {
          id: m.sellListing.id,
          referenceNumber: m.sellListing.referenceNumber,
          status: m.sellListing.status,
        },
      })),
      meta: paginationMeta(page, limit, total),
    };
  }
}
