import { Injectable } from '@nestjs/common';
import {
  EntityOwnerType,
  ImportListingSource,
  ImportListingStatus,
  ImportNegotiationStatus,
  ImportQuantityUnit,
  ImportSide,
  ImportTradeParty,
  Prisma,
  type ImportListing,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  resolveSearch,
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
import {
  ImportLifecycleService,
  type LifecycleActor,
} from '../common/import-lifecycle.service.js';
import { ImportMasterService } from '../common/import-master.service.js';
import { ImportNotifierService } from '../common/import-notifier.service.js';
import { ImportReferenceService } from '../common/import-reference.service.js';
import { ImportSettingsService } from '../common/import-settings.service.js';
import { toDecimal } from '../domain/import-decimal.js';
import {
  IMPORT_NOTIFICATION_EVENTS,
  LIVE_EDITABLE_STATUSES,
  LOCKED_AFTER_PUBLISH,
  OPEN_LISTING_STATUSES,
  sideReferenceKind,
} from '../domain/import.constants.js';
import {
  ImportException,
  throwFieldErrors,
  type ImportFieldError,
} from '../domain/import.errors.js';
import { assertTransition } from '../domain/import-status.machine.js';
import {
  normalizeHsCode,
  validateListing,
} from '../domain/import-validation.js';
import { ImportMatchingService } from '../matching/import-matching.service.js';
import type {
  CreateImportListingDto,
  ImportListingFieldsDto,
  ListImportListingsQueryDto,
  UpdateImportListingDto,
} from './dto/import-listing.dto.js';
import {
  LISTING_INCLUDE,
  mapListing,
  type ListingWithRelations,
} from './import-listing.mapper.js';

type ListingData = Omit<
  Prisma.ImportListingUncheckedCreateInput,
  'id' | 'referenceNumber' | 'side' | 'ownerOrgId' | 'documentRequirements'
>;

type OwnerContext = {
  orgId: string;
  customerProfileId: string | null;
  sellerProfileId: string | null;
  canTrade: () => void;
};

const toDate = (value: string | null | undefined) =>
  value === undefined
    ? undefined
    : value === null
      ? null
      : new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
const toInstant = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(value);
const trimOrNull = (value: string | null | undefined) =>
  value === undefined
    ? undefined
    : value === null
      ? null
      : value.trim() || null;

/** Blank listing used as the base when validating a brand-new draft. */
function blankListing(side: ImportSide): ImportListing {
  const nulls = Object.fromEntries(
    [
      'categoryId',
      'gradeId',
      'customGradeName',
      'brandId',
      'originCountryId',
      'quantity',
      'packagingId',
      'application',
      'hsCode',
      'casNumber',
      'price',
      'currencyId',
      'currencyCode',
      'priceType',
      'incotermId',
      'priceBasisPortId',
      'priceBasisLocation',
      'paymentTermId',
      'gstTreatment',
      'polId',
      'podId',
      'esd',
      'lsd',
      'transitMinDays',
      'transitMaxDays',
      'partialShipment',
      'transshipment',
      'shipmentType',
      'containerSize',
      'containerCount',
      'specification',
      'inspectionType',
      'acceptableQuantityMin',
      'acceptableQuantityMax',
      'requiredDeliveryDate',
      'specialRequirements',
      'moq',
      'maximumQuantity',
      'readyStockType',
      'remarks',
      'validFrom',
      'validUntil',
    ].map((k) => [k, null]),
  );
  return {
    ...nulls,
    side,
    quantityUnit: ImportQuantityUnit.MT,
    priceUnit: ImportQuantityUnit.MT,
  } as unknown as ImportListing;
}

@Injectable()
export class ImportListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actors: ImportActorService,
    private readonly master: ImportMasterService,
    private readonly settings: ImportSettingsService,
    private readonly references: ImportReferenceService,
    private readonly idempotency: ImportIdempotencyService,
    private readonly audit: ImportAuditService,
    private readonly notifier: ImportNotifierService,
    private readonly matching: ImportMatchingService,
    private readonly lifecycle: ImportLifecycleService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private owner(actor: ImportActor, side: ImportSide): OwnerContext {
    if (side === ImportSide.BUY) {
      const buyer = this.actors.requireBuyer(actor);
      return {
        orgId: buyer.organizationId,
        customerProfileId: buyer.customerProfileId,
        sellerProfileId: null,
        canTrade: () => this.actors.assertBuyerCanTrade(buyer),
      };
    }
    const seller = this.actors.requireSeller(actor);
    return {
      orgId: seller.organizationId,
      customerProfileId: null,
      sellerProfileId: seller.sellerProfileId,
      canTrade: () => this.actors.assertSellerCanTrade(seller),
    };
  }

  private lifecycleActor(actor: ImportActor, side: ImportSide): LifecycleActor {
    return {
      userId: actor.userId,
      role: this.actors.actorRole(actor, side),
      party:
        side === ImportSide.BUY
          ? ImportTradeParty.BUYER
          : ImportTradeParty.SELLER,
    };
  }

  private auditAction(
    side: ImportSide,
    kind: 'CREATED' | 'UPDATED' | 'PUBLISHED' | 'DELETED',
  ) {
    return IMPORT_AUDIT_ACTIONS[
      `${side}_${kind}` as keyof typeof IMPORT_AUDIT_ACTIONS
    ];
  }

  /**
   * Only fields present in the request are written; identity/status never come
   * from the client. BUY validity is server-managed, so it is never accepted.
   */
  private toData(
    dto: ImportListingFieldsDto,
    side: ImportSide,
  ): Partial<ListingData> {
    const data: Partial<ListingData> = {
      categoryId: dto.categoryId,
      gradeId: dto.gradeId,
      customGradeName: trimOrNull(dto.customGradeName),
      brandId: dto.brandId,
      originCountryId: dto.originCountryId,
      quantity:
        dto.quantity === undefined ? undefined : toDecimal(dto.quantity),
      quantityUnit: dto.quantityUnit,
      packagingId: dto.packagingId,
      application: trimOrNull(dto.application),
      hsCode:
        dto.hsCode === undefined ? undefined : normalizeHsCode(dto.hsCode),
      casNumber: trimOrNull(dto.casNumber),
      price: dto.price === undefined ? undefined : toDecimal(dto.price),
      currencyId: dto.currencyId,
      priceUnit: dto.priceUnit,
      priceType: dto.priceType,
      incotermId: dto.incotermId,
      priceBasisPortId: dto.priceBasisPortId,
      priceBasisLocation: trimOrNull(dto.priceBasisLocation),
      paymentTermId: dto.paymentTermId,
      gstTreatment: dto.gstTreatment,
      polId: dto.polId,
      podId: dto.podId,
      esd: toDate(dto.esd),
      lsd: toDate(dto.lsd),
      transitMinDays: dto.transitMinDays,
      transitMaxDays: dto.transitMaxDays,
      partialShipment: dto.partialShipment,
      transshipment: dto.transshipment,
      shipmentType: dto.shipmentType,
      containerSize: dto.containerSize,
      containerCount: dto.containerCount,
      specification: trimOrNull(dto.specification),
      inspectionType: dto.inspectionType,
      acceptableQuantityMin:
        dto.acceptableQuantityMin === undefined
          ? undefined
          : toDecimal(dto.acceptableQuantityMin),
      acceptableQuantityMax:
        dto.acceptableQuantityMax === undefined
          ? undefined
          : toDecimal(dto.acceptableQuantityMax),
      requiredDeliveryDate: toDate(dto.requiredDeliveryDate),
      specialRequirements: trimOrNull(dto.specialRequirements),
      moq: dto.moq === undefined ? undefined : toDecimal(dto.moq),
      maximumQuantity:
        dto.maximumQuantity === undefined
          ? undefined
          : toDecimal(dto.maximumQuantity),
      readyStockType: dto.readyStockType,
      remarks: trimOrNull(dto.remarks),
      validFrom: side === ImportSide.BUY ? undefined : toInstant(dto.validFrom),
      validUntil:
        side === ImportSide.BUY ? undefined : toInstant(dto.validUntil),
      rawInput: dto.rawInput,
    };
    for (const key of Object.keys(data) as Array<keyof ListingData>) {
      if (data[key] === undefined) delete data[key];
    }
    return data;
  }

  /** Resolves master references + business rules for the merged state. */
  private async check(
    merged: ImportListing,
    documentRequirementIds: string[],
    mode: 'draft' | 'publish',
  ) {
    const resolved = await this.master.resolve(
      { ...merged, documentRequirementIds },
      merged.customGradeName,
    );
    const { allowCustomGrade } = await this.settings.get();
    const errors: ImportFieldError[] = [
      ...resolved.errors,
      ...validateListing(
        {
          ...merged,
          currencyCode: resolved.currencyCode,
          paymentTermCurrencyCodes: resolved.paymentTermCurrencyCodes,
        },
        { mode, now: new Date(), allowCustomGrade },
      ),
    ];
    throwFieldErrors(errors);
    return resolved;
  }

  private async loadOwned(actor: ImportActor, side: ImportSide, id: string) {
    const owner = this.owner(actor, side);
    const listing = await this.prisma.importListing.findFirst({
      where: { id, side, ownerOrgId: owner.orgId, deletedAt: null },
      include: LISTING_INCLUDE,
    });
    if (!listing) throw new ImportException('IMPORT_NOT_FOUND');
    return { owner, listing };
  }

  private docIds(listing: ListingWithRelations) {
    return listing.documentRequirements.map((d) => d.documentRequirementId);
  }

  private async reload(id: string) {
    return this.prisma.importListing.findUniqueOrThrow({
      where: { id },
      include: LISTING_INCLUDE,
    });
  }

  /** BUY requests open now and close after the Admin-configured number of days. */
  private async buyRequestValidity(now: Date) {
    const { buyRequestValidityDays } = await this.settings.get();
    return {
      validFrom: now,
      validUntil: new Date(now.getTime() + buyRequestValidityDays * 86_400_000),
      nearExpiryNotifiedAt: null,
    };
  }

  /** Server time decides expiry: an overdue open listing is expired on read. */
  private async expireIfDue(
    listing: ListingWithRelations,
  ): Promise<ListingWithRelations> {
    const overdue =
      listing.validUntil &&
      listing.validUntil <= new Date() &&
      [...OPEN_LISTING_STATUSES, ImportListingStatus.PAUSED].includes(
        listing.status,
      );
    if (!overdue) return listing;
    await this.lifecycle.endListing(
      listing.id,
      'EXPIRED',
      {
        userId: null,
        role: 'SYSTEM',
        party: ImportTradeParty.SYSTEM,
      },
      { validateTransition: false },
    );
    return this.reload(listing.id);
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async create(
    user: AuthenticatedUser,
    side: ImportSide,
    dto: CreateImportListingDto,
  ) {
    const actor = await this.actors.resolve(user);
    const owner = this.owner(actor, side);
    const data = this.toData(dto, side);
    const docIds = [...new Set(dto.documentRequirementIds ?? [])];
    const merged = { ...blankListing(side), ...data } as ImportListing;
    const resolved = await this.check(merged, docIds, 'draft');

    const listing = await this.prisma.$transaction(async (tx) => {
      const referenceNumber = await this.references.next(
        sideReferenceKind(side),
        tx,
      );
      return tx.importListing.create({
        data: {
          ...data,
          referenceNumber,
          side,
          status: ImportListingStatus.DRAFT,
          source:
            dto.source === 'MOBILE'
              ? ImportListingSource.MOBILE
              : ImportListingSource.WEB,
          ownerOrgId: owner.orgId,
          customerProfileId: owner.customerProfileId,
          sellerProfileId: owner.sellerProfileId,
          createdById: actor.userId,
          updatedById: actor.userId,
          currencyCode: resolved.currencyCode,
          documentRequirements: docIds.length
            ? {
                createMany: {
                  data: docIds.map((documentRequirementId) => ({
                    documentRequirementId,
                  })),
                },
              }
            : undefined,
        },
        include: LISTING_INCLUDE,
      });
    });

    await this.audit.log({
      action: this.auditAction(side, 'CREATED'),
      actorUserId: actor.userId,
      actorRole: this.actors.actorRole(actor, side),
      organizationId: owner.orgId,
      entityType: EntityOwnerType.IMPORT_LISTING,
      entityId: listing.id,
      newData: {
        referenceNumber: listing.referenceNumber,
        status: listing.status,
      },
      metadata: {
        referenceNumber: listing.referenceNumber,
        side,
        source: listing.source,
      },
    });
    return mapListing(listing, 'owner');
  }

  async update(
    user: AuthenticatedUser,
    side: ImportSide,
    id: string,
    dto: UpdateImportListingDto,
  ) {
    const actor = await this.actors.resolve(user);
    const { owner, listing } = await this.loadOwned(actor, side, id);
    const isDraft = listing.status === ImportListingStatus.DRAFT;
    if (!isDraft && !LIVE_EDITABLE_STATUSES.includes(listing.status)) {
      throw new ImportException(
        'IMPORT_INVALID_STATUS_TRANSITION',
        `A ${listing.status.toLowerCase().replace(/_/g, ' ')} listing cannot be edited.`,
      );
    }
    if (dto.version !== undefined && dto.version !== listing.version) {
      throw new ImportException('IMPORT_DRAFT_CONFLICT', undefined, {
        currentVersion: listing.version,
      });
    }

    const data = this.toData(dto, side);
    if (!isDraft) {
      const locked: ImportFieldError[] = [];
      for (const field of LOCKED_AFTER_PUBLISH) {
        if (
          field in data &&
          String(data[field] ?? '') !== String(listing[field] ?? '')
        ) {
          locked.push({
            field,
            code: 'FIELD_LOCKED',
            message:
              'This field cannot change after publishing. Cancel and create a new listing instead.',
          });
        }
      }
      throwFieldErrors(locked);
    }

    const docIds =
      dto.documentRequirementIds !== undefined
        ? [...new Set(dto.documentRequirementIds)]
        : this.docIds(listing);
    const merged = { ...listing, ...data } as unknown as ImportListing;
    if (!isDraft) owner.canTrade();
    const resolved = await this.check(
      merged,
      docIds,
      isDraft ? 'draft' : 'publish',
    );

    await this.prisma.$transaction(async (tx) => {
      const res = await tx.importListing.updateMany({
        where: { id, version: listing.version, deletedAt: null },
        data: {
          ...data,
          currencyCode: resolved.currencyCode,
          updatedById: actor.userId,
          version: { increment: 1 },
          ...(data.validUntil !== undefined
            ? { nearExpiryNotifiedAt: null }
            : {}),
          ...(isDraft
            ? {}
            : {
                snapshot: resolved.snapshot as unknown as Prisma.InputJsonValue,
              }),
        },
      });
      if (res.count === 0) {
        throw new ImportException('IMPORT_DRAFT_CONFLICT');
      }
      if (dto.documentRequirementIds !== undefined) {
        await tx.importListingDocumentRequirement.deleteMany({
          where: { listingId: id },
        });
        if (docIds.length) {
          await tx.importListingDocumentRequirement.createMany({
            data: docIds.map((documentRequirementId) => ({
              listingId: id,
              documentRequirementId,
            })),
          });
        }
      }
    });

    const updated = await this.reload(id);
    const changes = this.diff(listing, updated);
    await this.audit.log({
      action: this.auditAction(side, 'UPDATED'),
      actorUserId: actor.userId,
      actorRole: this.actors.actorRole(actor, side),
      organizationId: owner.orgId,
      entityType: EntityOwnerType.IMPORT_LISTING,
      entityId: id,
      previousData: Object.fromEntries(changes.map((c) => [c.field, c.from])),
      newData: Object.fromEntries(changes.map((c) => [c.field, c.to])),
      metadata: {
        referenceNumber: listing.referenceNumber,
        side,
        status: listing.status,
        live: !isDraft,
      },
    });

    if (!isDraft && changes.length) {
      await this.notifyLiveChanges(
        updated,
        changes.map((c) => c.field),
      );
      await this.matching.recomputeSafely(id);
    }
    return mapListing(isDraft ? updated : await this.reload(id), 'owner');
  }

  private diff(before: ListingWithRelations, after: ListingWithRelations) {
    const fields = [
      'quantity',
      'price',
      'priceType',
      'priceBasisPortId',
      'priceBasisLocation',
      'paymentTermId',
      'gstTreatment',
      'esd',
      'lsd',
      'transitMinDays',
      'transitMaxDays',
      'partialShipment',
      'transshipment',
      'shipmentType',
      'containerSize',
      'containerCount',
      'specification',
      'inspectionType',
      'moq',
      'maximumQuantity',
      'readyStockType',
      'acceptableQuantityMin',
      'acceptableQuantityMax',
      'requiredDeliveryDate',
      'validUntil',
      'packagingId',
      'hsCode',
      'casNumber',
      'remarks',
      'categoryId',
      'gradeId',
      'customGradeName',
      'brandId',
      'originCountryId',
      'currencyId',
      'incotermId',
      'polId',
      'podId',
    ] as const;
    const norm = (v: unknown) =>
      v instanceof Date
        ? v.toISOString()
        : v === null || v === undefined
          ? null
          : String(v);
    const out: Array<{
      field: string;
      from: string | null;
      to: string | null;
    }> = [];
    for (const f of fields) {
      const from = norm(before[f]);
      const to = norm(after[f]);
      if (from !== to) out.push({ field: f, from, to });
    }
    const beforeDocs = this.docIds(before).sort().join(',');
    const afterDocs = this.docIds(after).sort().join(',');
    if (beforeDocs !== afterDocs)
      out.push({
        field: 'documentRequirementIds',
        from: beforeDocs,
        to: afterDocs,
      });
    return out;
  }

  /** Counterparties with an open negotiation hear about material changes. */
  private async notifyLiveChanges(
    listing: ListingWithRelations,
    fields: string[],
  ) {
    const events: Array<{
      event: (typeof IMPORT_NOTIFICATION_EVENTS)[keyof typeof IMPORT_NOTIFICATION_EVENTS];
      label: string;
    }> = [];
    if (fields.includes('price') || fields.includes('priceType')) {
      events.push({
        event: IMPORT_NOTIFICATION_EVENTS.PRICE_CHANGED,
        label: 'price',
      });
    }
    if (
      fields.some((f) =>
        [
          'esd',
          'lsd',
          'transitMinDays',
          'transitMaxDays',
          'shipmentType',
          'partialShipment',
          'transshipment',
        ].includes(f),
      )
    ) {
      events.push({
        event: IMPORT_NOTIFICATION_EVENTS.SHIPMENT_CHANGED,
        label: 'shipment schedule',
      });
    }
    if (fields.includes('paymentTermId')) {
      events.push({
        event: IMPORT_NOTIFICATION_EVENTS.PAYMENT_TERMS_CHANGED,
        label: 'payment terms',
      });
    }
    if (!events.length) return;

    const negotiations = await this.prisma.importNegotiation.findMany({
      where: {
        status: ImportNegotiationStatus.OPEN,
        OR: [{ buyListingId: listing.id }, { sellListingId: listing.id }],
      },
      select: {
        id: true,
        buyerOrgId: true,
        sellerOrgId: true,
        referenceNumber: true,
      },
    });
    for (const n of negotiations) {
      const org =
        listing.side === ImportSide.BUY ? n.sellerOrgId : n.buyerOrgId;
      for (const e of events) {
        await this.notifier.notify({
          organizationId: org,
          event: e.event,
          title: `Import ${e.label} updated`,
          body: `${listing.referenceNumber} changed its ${e.label}. Review negotiation ${n.referenceNumber}.`,
          entityType: EntityOwnerType.IMPORT_NEGOTIATION,
          entityId: n.id,
          metadata: {
            negotiationId: n.id,
            listingReference: listing.referenceNumber,
            changedFields: fields,
          },
        });
      }
    }
  }

  async publish(
    user: AuthenticatedUser,
    side: ImportSide,
    id: string,
    rawKey?: string,
  ) {
    const actor = await this.actors.resolve(user);
    const key = this.idempotency.normalise(rawKey);
    const replayed = await this.idempotency.replay(
      actor.userId,
      'LISTING_PUBLISH',
      key,
    );
    if (replayed) {
      const { listing } = await this.loadOwned(actor, side, replayed);
      return mapListing(listing, 'owner');
    }

    const { owner, listing } = await this.loadOwned(actor, side, id);
    if (listing.status !== ImportListingStatus.DRAFT) {
      throw new ImportException(
        listing.status === ImportListingStatus.EXPIRED
          ? 'IMPORT_ALREADY_EXPIRED'
          : 'IMPORT_ALREADY_PUBLISHED',
      );
    }
    owner.canTrade();
    const resolved = await this.check(listing, this.docIds(listing), 'publish');
    const now = new Date();
    const validity =
      side === ImportSide.BUY
        ? await this.buyRequestValidity(now)
        : { validFrom: listing.validFrom ?? now };

    await this.prisma.$transaction(async (tx) => {
      const res = await tx.importListing.updateMany({
        where: {
          id,
          status: ImportListingStatus.DRAFT,
          version: listing.version,
        },
        data: {
          status: ImportListingStatus.PUBLISHED,
          publishedAt: now,
          ...validity,
          currencyCode: resolved.currencyCode,
          snapshot: resolved.snapshot as unknown as Prisma.InputJsonValue,
          updatedById: actor.userId,
          version: { increment: 1 },
        },
      });
      if (res.count === 0) throw new ImportException('IMPORT_DRAFT_CONFLICT');
      await this.idempotency.record(
        tx,
        actor.userId,
        'LISTING_PUBLISH',
        key,
        id,
      );
    });

    await this.audit.log({
      action: this.auditAction(side, 'PUBLISHED'),
      actorUserId: actor.userId,
      actorRole: this.actors.actorRole(actor, side),
      organizationId: owner.orgId,
      entityType: EntityOwnerType.IMPORT_LISTING,
      entityId: id,
      previousData: { status: ImportListingStatus.DRAFT },
      newData: {
        status: ImportListingStatus.PUBLISHED,
        snapshot: resolved.snapshot,
      },
      metadata: { referenceNumber: listing.referenceNumber, side },
    });
    await this.matching.recomputeSafely(id);
    return mapListing(await this.reload(id), 'owner');
  }

  async pause(user: AuthenticatedUser, side: ImportSide, id: string) {
    const actor = await this.actors.resolve(user);
    const { owner, listing } = await this.loadOwned(actor, side, id);
    assertTransition(listing.status, ImportListingStatus.PAUSED);
    await this.transition(listing, ImportListingStatus.PAUSED, {
      pausedAt: new Date(),
    });
    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.SELL_PAUSED,
      actorUserId: actor.userId,
      actorRole: this.actors.actorRole(actor, side),
      organizationId: owner.orgId,
      entityType: EntityOwnerType.IMPORT_LISTING,
      entityId: id,
      previousData: { status: listing.status },
      newData: { status: ImportListingStatus.PAUSED },
      metadata: { referenceNumber: listing.referenceNumber, side },
    });
    await this.matching.recomputeSafely(id);
    return mapListing(await this.reload(id), 'owner');
  }

  async resume(user: AuthenticatedUser, side: ImportSide, id: string) {
    const actor = await this.actors.resolve(user);
    const { owner, listing } = await this.loadOwned(actor, side, id);
    if (listing.status !== ImportListingStatus.PAUSED) {
      throw new ImportException(
        'IMPORT_INVALID_STATUS_TRANSITION',
        'Only paused listings can be resumed.',
      );
    }
    if (listing.validUntil && listing.validUntil <= new Date()) {
      throw new ImportException('OFFER_EXPIRED');
    }
    owner.canTrade();
    await this.transition(listing, ImportListingStatus.PUBLISHED, {
      pausedAt: null,
    });
    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.SELL_RESUMED,
      actorUserId: actor.userId,
      actorRole: this.actors.actorRole(actor, side),
      organizationId: owner.orgId,
      entityType: EntityOwnerType.IMPORT_LISTING,
      entityId: id,
      previousData: { status: ImportListingStatus.PAUSED },
      newData: { status: ImportListingStatus.PUBLISHED },
      metadata: { referenceNumber: listing.referenceNumber, side },
    });
    await this.matching.recomputeSafely(id);
    return mapListing(await this.reload(id), 'owner');
  }

  private async transition(
    listing: ListingWithRelations,
    status: ImportListingStatus,
    extra: Prisma.ImportListingUpdateManyMutationInput = {},
  ) {
    const res = await this.prisma.importListing.updateMany({
      where: {
        id: listing.id,
        status: listing.status,
        version: listing.version,
      },
      data: { ...extra, status, version: { increment: 1 } },
    });
    if (res.count === 0) throw new ImportException('IMPORT_DRAFT_CONFLICT');
  }

  async cancel(
    user: AuthenticatedUser,
    side: ImportSide,
    id: string,
    reason?: string,
  ) {
    const actor = await this.actors.resolve(user);
    const { listing } = await this.loadOwned(actor, side, id);
    assertTransition(listing.status, ImportListingStatus.CANCELLED);
    await this.lifecycle.endListing(
      id,
      'CANCELLED',
      this.lifecycleActor(actor, side),
      {
        reason: reason?.trim() || null,
      },
    );
    return mapListing(await this.reload(id), 'owner');
  }

  async expire(user: AuthenticatedUser, side: ImportSide, id: string) {
    const actor = await this.actors.resolve(user);
    const { listing } = await this.loadOwned(actor, side, id);
    assertTransition(listing.status, ImportListingStatus.EXPIRED);
    await this.lifecycle.endListing(
      id,
      'EXPIRED',
      this.lifecycleActor(actor, side),
    );
    return mapListing(await this.reload(id), 'owner');
  }

  /** Drafts only; published listings are cancelled, never deleted. */
  async remove(user: AuthenticatedUser, side: ImportSide, id: string) {
    const actor = await this.actors.resolve(user);
    const { owner, listing } = await this.loadOwned(actor, side, id);
    if (listing.status !== ImportListingStatus.DRAFT) {
      throw new ImportException(
        'IMPORT_INVALID_STATUS_TRANSITION',
        'Only drafts can be deleted. Cancel a published listing instead.',
      );
    }
    await this.prisma.importListing.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      action: this.auditAction(side, 'DELETED'),
      actorUserId: actor.userId,
      actorRole: this.actors.actorRole(actor, side),
      organizationId: owner.orgId,
      entityType: EntityOwnerType.IMPORT_LISTING,
      entityId: id,
      metadata: { referenceNumber: listing.referenceNumber, side },
    });
    return { id, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Opposite-side actor that may browse this side's marketplace. */
  private marketViewerOrg(actor: ImportActor, side: ImportSide): string {
    if (side === ImportSide.BUY)
      return this.actors.requireSeller(actor).organizationId;
    return this.actors.requireBuyer(actor).organizationId;
  }

  async list(
    user: AuthenticatedUser,
    side: ImportSide,
    query: ListImportListingsQueryDto,
  ) {
    const actor = await this.actors.resolve(user);
    const isOwnerSide =
      (side === ImportSide.BUY && !!actor.buyer) ||
      (side === ImportSide.SELL && !!actor.seller);
    const scope = query.scope ?? (isOwnerSide ? 'mine' : 'market');
    const now = new Date();

    const and: Prisma.ImportListingWhereInput[] = [{ side, deletedAt: null }];
    if (scope === 'mine') {
      and.push({ ownerOrgId: this.owner(actor, side).orgId });
      if (query.status?.length) and.push({ status: { in: query.status } });
    } else {
      const viewerOrg = this.marketViewerOrg(actor, side);
      and.push(
        { ownerOrgId: { not: viewerOrg } },
        {
          status: {
            in: query.status?.length
              ? query.status.filter((s) => OPEN_LISTING_STATUSES.includes(s))
              : OPEN_LISTING_STATUSES,
          },
        },
        { validUntil: { gt: now } },
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
      );
    }

    const exact: Prisma.ImportListingWhereInput = {
      categoryId: query.categoryId,
      gradeId: query.gradeId,
      brandId: query.brandId,
      originCountryId: query.originCountryId,
      incotermId: query.incotermId,
      polId: query.polId,
      podId: query.podId,
      paymentTermId: query.paymentTermId,
      inspectionType: query.inspectionType,
      readyStockType: query.readyStockType,
      shipmentType: query.shipmentType,
    };
    and.push(exact);
    if (query.currencyCode)
      and.push({ currencyCode: query.currencyCode.toUpperCase() });

    if (query.priceMin || query.priceMax || query.sortBy === 'price') {
      if (!query.currencyCode) {
        throw new ImportException(
          'IMPORT_VALIDATION_FAILED',
          'Select a currency to filter or sort by price; prices in different currencies are not comparable.',
        );
      }
    }
    if (query.priceMin || query.priceMax) {
      and.push({
        price: {
          ...(query.priceMin ? { gte: toDecimal(query.priceMin)! } : {}),
          ...(query.priceMax ? { lte: toDecimal(query.priceMax)! } : {}),
        },
      });
    }
    if (query.quantityMin || query.quantityMax) {
      // Quantity filters are in MT; KG listings are converted, container listings excluded.
      const range = (factor: number) => ({
        ...(query.quantityMin
          ? { gte: toDecimal(query.quantityMin)!.mul(factor) }
          : {}),
        ...(query.quantityMax
          ? { lte: toDecimal(query.quantityMax)!.mul(factor) }
          : {}),
      });
      and.push({
        OR: [
          { quantityUnit: ImportQuantityUnit.MT, quantity: range(1) },
          { quantityUnit: ImportQuantityUnit.KG, quantity: range(1000) },
        ],
      });
    }
    if (query.shipmentFrom)
      and.push({ lsd: { gte: toDate(query.shipmentFrom)! } });
    if (query.shipmentTo) and.push({ esd: { lte: toDate(query.shipmentTo)! } });
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
          { specification: contains },
          { application: contains },
          { grade: { name: contains } },
          { category: { name: contains } },
          { brand: { name: contains } },
        ],
      });
    }

    const where: Prisma.ImportListingWhereInput = { AND: and };
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const sortBy = query.sortBy ?? 'createdAt';
    const [rows, total] = await Promise.all([
      this.prisma.importListing.findMany({
        where,
        include: LISTING_INCLUDE,
        orderBy: [{ [sortBy]: query.sortOrder ?? 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.importListing.count({ where }),
    ]);
    return {
      items: rows.map((row) =>
        mapListing(row, scope === 'mine' ? 'owner' : 'market', { now }),
      ),
      meta: { ...paginationMeta(page, limit, total), scope },
    };
  }

  async get(user: AuthenticatedUser, side: ImportSide, id: string) {
    const actor = await this.actors.resolve(user);
    let listing = await this.prisma.importListing.findFirst({
      where: { id, side, deletedAt: null },
      include: LISTING_INCLUDE,
    });
    if (!listing) throw new ImportException('IMPORT_NOT_FOUND');
    listing = await this.expireIfDue(listing);

    const ownOrg =
      side === ImportSide.BUY
        ? actor.buyer?.organizationId
        : actor.seller?.organizationId;
    if (ownOrg && ownOrg === listing.ownerOrgId) {
      const [negotiations, matches] = await Promise.all([
        this.prisma.importNegotiation.groupBy({
          by: ['status'],
          where: { OR: [{ buyListingId: id }, { sellListingId: id }] },
          _count: { _all: true },
        }),
        this.prisma.importMatch.count({
          where: {
            [side === ImportSide.BUY ? 'buyListingId' : 'sellListingId']: id,
            status: { in: ['SUGGESTED', 'NEGOTIATING', 'CONVERTED'] },
          },
        }),
      ]);
      return {
        ...mapListing(listing, 'owner'),
        viewerRole: 'OWNER' as const,
        stats: {
          matches,
          negotiations: Object.fromEntries(
            negotiations.map((g) => [g.status, g._count._all]),
          ),
        },
      };
    }

    const viewerOrg =
      side === ImportSide.BUY
        ? actor.seller?.organizationId
        : actor.buyer?.organizationId;
    if (!viewerOrg || viewerOrg === listing.ownerOrgId)
      throw new ImportException('IMPORT_NOT_FOUND');
    const mine = await this.prisma.importNegotiation.findFirst({
      where: {
        ...(side === ImportSide.BUY
          ? { buyListingId: id, sellerOrgId: viewerOrg }
          : { sellListingId: id, buyerOrgId: viewerOrg }),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, referenceNumber: true, status: true },
    });
    const visible =
      OPEN_LISTING_STATUSES.includes(listing.status) &&
      (!listing.validFrom || listing.validFrom <= new Date());
    if (!visible && !mine) throw new ImportException('IMPORT_NOT_FOUND');
    return {
      ...mapListing(listing, 'market'),
      viewerRole: 'COUNTERPARTY' as const,
      myNegotiation: mine,
    };
  }

  async matches(user: AuthenticatedUser, side: ImportSide, id: string) {
    const actor = await this.actors.resolve(user);
    const { listing } = await this.loadOwned(actor, side, id);
    return this.matching.listForListing(listing.id, side);
  }

  async dismissMatch(
    user: AuthenticatedUser,
    side: ImportSide,
    id: string,
    matchId: string,
  ) {
    const actor = await this.actors.resolve(user);
    const { listing } = await this.loadOwned(actor, side, id);
    const res = await this.matching.dismiss(matchId, listing.id);
    if (res.count === 0)
      throw new ImportException('IMPORT_NOT_FOUND', 'Match not found.');
    return { id: matchId, status: 'DISMISSED' };
  }

  /** Dashboard counters for whichever sides the caller trades on. */
  async summary(user: AuthenticatedUser) {
    const actor = await this.actors.resolve(user);
    const count = async (side: ImportSide, orgId: string) => {
      const groups = await this.prisma.importListing.groupBy({
        by: ['status'],
        where: { side, ownerOrgId: orgId, deletedAt: null },
        _count: { _all: true },
      });
      return Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
    };
    const orgFilter = (orgId: string, party: 'buyerOrgId' | 'sellerOrgId') => ({
      [party]: orgId,
    });

    const result: Record<string, unknown> = { serverTime: new Date() };
    if (actor.buyer) {
      const org = actor.buyer.organizationId;
      const [listings, openNegotiations, pendingDeals] = await Promise.all([
        count(ImportSide.BUY, org),
        this.prisma.importNegotiation.count({
          where: { ...orgFilter(org, 'buyerOrgId'), status: 'OPEN' },
        }),
        this.prisma.importDeal.count({
          where: {
            ...orgFilter(org, 'buyerOrgId'),
            status: 'PENDING_CONFIRMATION',
          },
        }),
      ]);
      result.buy = { listings, openNegotiations, pendingDeals };
    }
    if (actor.seller) {
      const org = actor.seller.organizationId;
      const [listings, openNegotiations, pendingDeals] = await Promise.all([
        count(ImportSide.SELL, org),
        this.prisma.importNegotiation.count({
          where: { ...orgFilter(org, 'sellerOrgId'), status: 'OPEN' },
        }),
        this.prisma.importDeal.count({
          where: {
            ...orgFilter(org, 'sellerOrgId'),
            status: 'PENDING_CONFIRMATION',
          },
        }),
      ]);
      result.sell = { listings, openNegotiations, pendingDeals };
    }
    return result;
  }
}
