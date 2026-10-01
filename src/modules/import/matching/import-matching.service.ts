import { Injectable, Logger } from '@nestjs/common';
import {
  EntityOwnerType,
  ImportListingStatus,
  ImportMatchStatus,
  ImportSide,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { ImportNotifierService } from '../common/import-notifier.service.js';
import { ImportSettingsService } from '../common/import-settings.service.js';
import {
  IMPORT_NOTIFICATION_EVENTS,
  OPEN_LISTING_STATUSES,
} from '../domain/import.constants.js';
import {
  scoreMatch,
  type MatchableListing,
  type MatchResult,
} from '../domain/import-matching.js';
import {
  LISTING_INCLUDE,
  mapListing,
} from '../listings/import-listing.mapper.js';

const CANDIDATE_LIMIT = 500;

const MATCHABLE_SELECT = {
  id: true,
  side: true,
  status: true,
  ownerOrgId: true,
  referenceNumber: true,
  validUntil: true,
  deletedAt: true,
  categoryId: true,
  gradeId: true,
  customGradeName: true,
  brandId: true,
  originCountryId: true,
  quantity: true,
  quantityUnit: true,
  acceptableQuantityMin: true,
  acceptableQuantityMax: true,
  moq: true,
  maximumQuantity: true,
  price: true,
  currencyCode: true,
  priceUnit: true,
  incotermId: true,
  priceBasisPortId: true,
  priceBasisLocation: true,
  polId: true,
  podId: true,
  paymentTermId: true,
  esd: true,
  lsd: true,
  inspectionType: true,
  documentRequirements: { select: { documentRequirementId: true } },
} satisfies Prisma.ImportListingSelect;

type MatchableRow = Prisma.ImportListingGetPayload<{
  select: typeof MATCHABLE_SELECT;
}>;

const toMatchable = (row: MatchableRow): MatchableListing => ({
  ...row,
  documentRequirementIds: row.documentRequirements.map(
    (d) => d.documentRequirementId,
  ),
});

/**
 * Rule-based, explainable matching (not AI). Every score is reproducible from
 * the stored evidence, weights and algorithm version.
 */
@Injectable()
export class ImportMatchingService {
  private readonly logger = new Logger(ImportMatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ImportSettingsService,
    private readonly notifier: ImportNotifierService,
  ) {}

  private isOpen(
    row: {
      status: ImportListingStatus;
      validUntil: Date | null;
      deletedAt: Date | null;
    },
    now: Date,
  ) {
    return (
      OPEN_LISTING_STATUSES.includes(row.status) &&
      !row.deletedAt &&
      (!row.validUntil || row.validUntil > now)
    );
  }

  /** Recompute and persist matches for one listing against all open counter-listings. */
  async recomputeForListing(
    listingId: string,
  ): Promise<{ matched: number; newMatches: number }> {
    const now = new Date();
    const listing = await this.prisma.importListing.findUnique({
      where: { id: listingId },
      select: MATCHABLE_SELECT,
    });
    if (!listing) return { matched: 0, newMatches: 0 };

    const column =
      listing.side === ImportSide.BUY ? 'buyListingId' : 'sellListingId';
    if (!this.isOpen(listing, now) || !listing.categoryId) {
      await this.prisma.importMatch.updateMany({
        where: { [column]: listing.id, status: ImportMatchStatus.SUGGESTED },
        data: { status: ImportMatchStatus.STALE },
      });
      return { matched: 0, newMatches: 0 };
    }

    const { matchWeights, minMatchScore } = await this.settings.get();
    const candidates = await this.prisma.importListing.findMany({
      where: {
        side:
          listing.side === ImportSide.BUY ? ImportSide.SELL : ImportSide.BUY,
        status: { in: OPEN_LISTING_STATUSES },
        categoryId: listing.categoryId,
        deletedAt: null,
        ownerOrgId: { not: listing.ownerOrgId },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      select: MATCHABLE_SELECT,
      orderBy: { publishedAt: 'desc' },
      take: CANDIDATE_LIMIT,
    });

    const existing = await this.prisma.importMatch.findMany({
      where: { [column]: listing.id },
      select: {
        id: true,
        buyListingId: true,
        sellListingId: true,
        status: true,
      },
    });
    const existingByPair = new Map(
      existing.map((m) => [`${m.buyListingId}:${m.sellListingId}`, m]),
    );

    const self = toMatchable(listing);
    let matched = 0;
    const fresh: Array<{ result: MatchResult; counter: MatchableRow }> = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      const [buy, sell] =
        listing.side === ImportSide.BUY
          ? [self, toMatchable(candidate)]
          : [toMatchable(candidate), self];
      const result = scoreMatch(buy, sell, matchWeights);
      const key = `${result.buyListingId}:${result.sellListingId}`;
      seen.add(key);
      const prior = existingByPair.get(key);

      if (result.matchScore < minMatchScore) {
        if (prior?.status === ImportMatchStatus.SUGGESTED) {
          await this.prisma.importMatch.update({
            where: { id: prior.id },
            data: {
              status: ImportMatchStatus.STALE,
              score: result.matchScore,
              computedAt: now,
            },
          });
        }
        continue;
      }

      matched += 1;
      const data = {
        score: result.matchScore,
        matchedCriteria: result.matchedCriteria,
        unmatchedCriteria: result.unmatchedCriteria,
        evidence: result.evidence as unknown as Prisma.InputJsonValue,
        weights: result.weights as unknown as Prisma.InputJsonValue,
        algorithmVersion: result.algorithmVersion,
        computedAt: now,
      };
      if (prior) {
        await this.prisma.importMatch.update({
          where: { id: prior.id },
          data: {
            ...data,
            ...(prior.status === ImportMatchStatus.STALE
              ? { status: ImportMatchStatus.SUGGESTED }
              : {}),
          },
        });
      } else {
        await this.prisma.importMatch.create({
          data: {
            ...data,
            buyListingId: result.buyListingId,
            sellListingId: result.sellListingId,
            status: ImportMatchStatus.SUGGESTED,
          },
        });
        fresh.push({ result, counter: candidate });
      }
    }

    // Pairs that are no longer candidates (other side closed / category changed).
    const vanished = existing.filter(
      (m) =>
        !seen.has(`${m.buyListingId}:${m.sellListingId}`) &&
        m.status === ImportMatchStatus.SUGGESTED,
    );
    if (vanished.length) {
      await this.prisma.importMatch.updateMany({
        where: { id: { in: vanished.map((m) => m.id) } },
        data: { status: ImportMatchStatus.STALE },
      });
    }

    if (matched > 0) {
      await this.prisma.importListing.updateMany({
        where: { id: listing.id, status: ImportListingStatus.PUBLISHED },
        data: { status: ImportListingStatus.MATCHING },
      });
    }
    for (const { result, counter } of fresh) {
      await this.prisma.importListing.updateMany({
        where: { id: counter.id, status: ImportListingStatus.PUBLISHED },
        data: { status: ImportListingStatus.MATCHING },
      });
      await this.notifyNewMatch(listing, counter, result.matchScore);
    }

    return { matched, newMatches: fresh.length };
  }

  /** Never throws: matching must not break the action that triggered it. */
  async recomputeSafely(listingId: string) {
    try {
      return await this.recomputeForListing(listingId);
    } catch (error) {
      this.logger.error(
        `Import matching failed for listing ${listingId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { matched: 0, newMatches: 0 };
    }
  }

  private async notifyNewMatch(
    a: MatchableRow,
    b: MatchableRow,
    score: number,
  ) {
    for (const [owner, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const kind = owner.side === ImportSide.BUY ? 'RFQ' : 'offer';
      const otherKind =
        other.side === ImportSide.BUY ? 'buy request' : 'sell offer';
      await this.notifier.notify({
        organizationId: owner.ownerOrgId,
        event: IMPORT_NOTIFICATION_EVENTS.MATCH_FOUND,
        title: 'New Import match',
        body: `Your ${kind} ${owner.referenceNumber} matches ${otherKind} ${other.referenceNumber} (match score ${score}%).`,
        entityType: EntityOwnerType.IMPORT_LISTING,
        entityId: owner.id,
        metadata: {
          listingId: owner.id,
          referenceNumber: owner.referenceNumber,
          side: owner.side,
          matchedListingId: other.id,
          matchedReferenceNumber: other.referenceNumber,
          matchScore: score,
        },
      });
    }
  }

  /** Matches for a listing the caller owns, counterparties shown blind. */
  async listForListing(listingId: string, side: ImportSide) {
    const column = side === ImportSide.BUY ? 'buyListingId' : 'sellListingId';
    const otherRelation =
      side === ImportSide.BUY ? 'sellListing' : 'buyListing';
    const rows = await this.prisma.importMatch.findMany({
      where: {
        [column]: listingId,
        status: {
          in: [
            ImportMatchStatus.SUGGESTED,
            ImportMatchStatus.NEGOTIATING,
            ImportMatchStatus.CONVERTED,
          ],
        },
      },
      include: { [otherRelation]: { include: LISTING_INCLUDE } },
      orderBy: [{ score: 'desc' }, { computedAt: 'desc' }],
      take: 100,
    });
    const now = new Date();
    return rows.map((row) => {
      const other = (row as unknown as Record<string, unknown>)[
        otherRelation
      ] as Parameters<typeof mapListing>[0];
      return {
        id: row.id,
        status: row.status,
        matchScore: Number(row.score),
        matchedCriteria: row.matchedCriteria,
        unmatchedCriteria: row.unmatchedCriteria,
        evidence: row.evidence,
        algorithmVersion: row.algorithmVersion,
        computedAt: row.computedAt,
        listing: mapListing(other, 'market', { now }),
      };
    });
  }

  async dismiss(matchId: string, listingId: string) {
    return this.prisma.importMatch.updateMany({
      where: {
        id: matchId,
        OR: [{ buyListingId: listingId }, { sellListingId: listingId }],
        status: ImportMatchStatus.SUGGESTED,
      },
      data: { status: ImportMatchStatus.DISMISSED },
    });
  }
}
