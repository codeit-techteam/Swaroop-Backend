import { Injectable } from '@nestjs/common';
import {
  EntityOwnerType,
  ImportDealStatus,
  ImportListingStatus,
  ImportShipmentStatus,
  ImportTradeParty,
  Prisma,
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
import { ImportNotifierService } from '../common/import-notifier.service.js';
import { ImportReferenceService } from '../common/import-reference.service.js';
import type { ListingSnapshot } from '../common/import-master.service.js';
import { decimalString, toDecimal } from '../domain/import-decimal.js';
import { IMPORT_NOTIFICATION_EVENTS } from '../domain/import.constants.js';
import {
  ImportException,
  throwFieldErrors,
  type ImportFieldError,
} from '../domain/import.errors.js';
import {
  ACTIVE_SHIPMENT_STATUSES,
  SHIPPABLE_DEAL_STATUSES,
  assertShipmentTransition,
  fulfilmentStatus,
  isTerminalShipment,
  milestoneFields,
} from '../domain/import-shipment.machine.js';
import { canTransition } from '../domain/import-status.machine.js';
import type {
  AddImportShipmentEventDto,
  AdminImportShipmentsQueryDto,
  CreateImportShipmentDto,
  ListImportShipmentsQueryDto,
  UpdateImportShipmentDto,
} from './dto/import-shipment.dto.js';
import {
  SHIPMENT_INCLUDE,
  mapShipment,
  type ShipmentRow,
  type ShipmentView,
} from './import-shipment.mapper.js';

/** Who is acting on a shipment: the deal's seller party or an Admin. */
export type ShipmentActor = {
  userId: string;
  role: string;
  party: typeof ImportTradeParty.SELLER | typeof ImportTradeParty.ADMIN;
};

type Tx = Prisma.TransactionClient;

/** Events may be back-dated (e.g. vessel sailed yesterday) but not future-dated. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const humanize = (s: string) => s.toLowerCase().replace(/_/g, ' ');

const toInstant = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : new Date(v);

const trimOrNull = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : v.trim() || null;

function portName(snapshot: unknown, key: 'pol' | 'pod'): string | null {
  const port = (snapshot as ListingSnapshot | null)?.[key];
  return port ? `${port.name} (${port.code})` : null;
}

@Injectable()
export class ImportShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actors: ImportActorService,
    private readonly references: ImportReferenceService,
    private readonly idempotency: ImportIdempotencyService,
    private readonly audit: ImportAuditService,
    private readonly notifier: ImportNotifierService,
  ) {}

  // ---------------------------------------------------------------------------
  // Trader queries
  // ---------------------------------------------------------------------------

  private partyScope(
    actor: ImportActor,
    as?: 'buyer' | 'seller',
  ): Prisma.ImportShipmentWhereInput {
    const or: Prisma.ImportShipmentWhereInput[] = [];
    if (actor.buyer && as !== 'seller')
      or.push({ buyerOrgId: actor.buyer.organizationId });
    if (actor.seller && as !== 'buyer')
      or.push({ sellerOrgId: actor.seller.organizationId });
    if (!or.length) throw new ImportException('IMPORT_PROFILE_REQUIRED');
    return { OR: or };
  }

  private searchWhere(search?: string): Prisma.ImportShipmentWhereInput {
    if (!search) return {};
    const contains = { contains: search, mode: Prisma.QueryMode.insensitive };
    return {
      OR: [
        { referenceNumber: contains },
        { trackingNumber: contains },
        { carrierName: contains },
        { vesselName: contains },
        { deal: { referenceNumber: contains } },
      ],
    };
  }

  async list(user: AuthenticatedUser, query: ListImportShipmentsQueryDto) {
    const actor = await this.actors.resolve(user);
    const where: Prisma.ImportShipmentWhereInput = {
      AND: [
        this.partyScope(actor, query.as),
        query.status ? { status: query.status } : {},
        query.dealId ? { dealId: query.dealId } : {},
        this.searchWhere(resolveSearch(query)),
      ],
    };
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const [rows, total] = await Promise.all([
      this.prisma.importShipment.findMany({
        where,
        include: SHIPMENT_INCLUDE,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.importShipment.count({ where }),
    ]);
    return {
      items: rows.map((s) => mapShipment(s, this.actors.partyFor(actor, s)!)),
      meta: paginationMeta(page, limit, total),
    };
  }

  private async loadForTrader(actor: ImportActor, id: string) {
    const shipment = await this.prisma.importShipment.findUnique({
      where: { id },
      include: SHIPMENT_INCLUDE,
    });
    const party = shipment ? this.actors.partyFor(actor, shipment) : null;
    if (!shipment || !party) throw new ImportException('SHIPMENT_NOT_FOUND');
    return { shipment, party };
  }

  async get(user: AuthenticatedUser, id: string) {
    const actor = await this.actors.resolve(user);
    const { shipment, party } = await this.loadForTrader(actor, id);
    return mapShipment(shipment, party);
  }

  /** Shipments of a deal, already authorised by the caller. */
  async forDeal(dealId: string, view: ShipmentView) {
    const rows = await this.prisma.importShipment.findMany({
      where: { dealId },
      include: SHIPMENT_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((s) => mapShipment(s, view));
  }

  // ---------------------------------------------------------------------------
  // Seller commands
  // ---------------------------------------------------------------------------

  private sellerActor(actor: ImportActor): ShipmentActor {
    return {
      userId: actor.userId,
      role: this.actors.actorRole(actor, ImportTradeParty.SELLER),
      party: ImportTradeParty.SELLER,
    };
  }

  /** Buyers may read a shipment but only the seller party may change it. */
  private assertSellerParty(party: ImportTradeParty, actor: ImportActor) {
    if (party !== ImportTradeParty.SELLER) {
      throw new ImportException(
        'IMPORT_UNAUTHORIZED',
        'Only the seller or the platform can update shipments.',
      );
    }
    this.actors.assertSellerCanTrade(this.actors.requireSeller(actor));
  }

  async create(
    user: AuthenticatedUser,
    dealId: string,
    dto: CreateImportShipmentDto,
    rawKey?: string,
  ) {
    const actor = await this.actors.resolve(user);
    const key = this.idempotency.normalise(rawKey);
    const replayed = await this.idempotency.replay(
      actor.userId,
      'SHIPMENT_CREATE',
      key,
    );
    if (replayed) return this.get(user, replayed);

    const deal = await this.prisma.importDeal.findUnique({
      where: { id: dealId },
      include: {
        sellListing: { select: { snapshot: true } },
        buyListing: { select: { snapshot: true } },
      },
    });
    const party = deal ? this.actors.partyFor(actor, deal) : null;
    if (!deal || !party) throw new ImportException('DEAL_NOT_FOUND');
    this.assertSellerParty(party, actor);

    const quantity = toDecimal(dto.quantity)!;
    const errors: ImportFieldError[] = [];
    if (quantity.lte(0)) {
      errors.push({
        field: 'quantity',
        code: 'INVALID_QUANTITY',
        message: 'Shipment quantity must be greater than 0.',
      });
    }
    this.checkSchedule(toInstant(dto.etd), toInstant(dto.eta), errors);
    throwFieldErrors(errors);

    const snapshot = deal.sellListing?.snapshot ?? deal.buyListing?.snapshot;
    const shipper = this.sellerActor(actor);
    const now = new Date();

    const id = await this.prisma.$transaction(async (tx) => {
      const fresh = await this.lockDeal(tx, dealId);
      if (!SHIPPABLE_DEAL_STATUSES.includes(fresh.status)) {
        throw new ImportException(
          'IMPORT_INVALID_STATUS_TRANSITION',
          `Shipments can only be added to a confirmed deal; this deal is ${humanize(fresh.status)}.`,
        );
      }
      const remaining = fresh.quantity.minus(await this.allocated(tx, dealId));
      if (quantity.gt(remaining)) {
        throw new ImportException(
          'INVALID_QUANTITY',
          `Only ${decimalString(remaining)} ${fresh.quantityUnit} of this deal is still unshipped.`,
          [
            {
              field: 'quantity',
              code: 'INVALID_QUANTITY',
              message: `Maximum ${decimalString(remaining)} ${fresh.quantityUnit}.`,
            },
          ],
        );
      }
      const referenceNumber = await this.references.next('SHIPMENT', tx);
      const created = await tx.importShipment.create({
        data: {
          referenceNumber,
          dealId,
          buyerOrgId: fresh.buyerOrgId,
          sellerOrgId: fresh.sellerOrgId,
          status: ImportShipmentStatus.BOOKED,
          mode: dto.mode,
          quantity,
          quantityUnit: fresh.quantityUnit,
          carrierName: trimOrNull(dto.carrierName),
          trackingNumber: trimOrNull(dto.trackingNumber),
          vesselName: trimOrNull(dto.vesselName),
          voyageNumber: trimOrNull(dto.voyageNumber),
          containerNumbers: this.containers(dto.containerNumbers) ?? [],
          originLocation:
            trimOrNull(dto.originLocation) ?? portName(snapshot, 'pol'),
          destinationLocation:
            trimOrNull(dto.destinationLocation) ?? portName(snapshot, 'pod'),
          etd: toInstant(dto.etd),
          eta: toInstant(dto.eta),
          remarks: trimOrNull(dto.remarks),
          createdById: actor.userId,
          updatedById: actor.userId,
          events: {
            create: {
              status: ImportShipmentStatus.BOOKED,
              description: 'Shipment booked',
              occurredAt: now,
              actorParty: shipper.party,
              actorUserId: actor.userId,
            },
          },
        },
      });
      await this.idempotency.record(
        tx,
        actor.userId,
        'SHIPMENT_CREATE',
        key,
        created.id,
      );
      return created.id;
    });

    const shipment = await this.reload(id);
    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.SHIPMENT_CREATED,
      actorUserId: actor.userId,
      actorRole: shipper.role,
      organizationId: deal.sellerOrgId,
      entityType: EntityOwnerType.IMPORT_SHIPMENT,
      entityId: id,
      newData: {
        status: shipment.status,
        quantity: decimalString(shipment.quantity),
        quantityUnit: shipment.quantityUnit,
        carrierName: shipment.carrierName,
        trackingNumber: shipment.trackingNumber,
      },
      metadata: {
        referenceNumber: shipment.referenceNumber,
        dealId,
        dealReference: deal.referenceNumber,
      },
    });
    await this.notifier.notify({
      organizationId: deal.buyerOrgId,
      event: IMPORT_NOTIFICATION_EVENTS.SHIPMENT_CREATED,
      title: 'Import shipment booked',
      body: `Shipment ${shipment.referenceNumber} for deal ${deal.referenceNumber} is booked: ${decimalString(shipment.quantity)} ${shipment.quantityUnit}.`,
      entityType: EntityOwnerType.IMPORT_SHIPMENT,
      entityId: id,
      metadata: {
        shipmentId: id,
        dealId,
        referenceNumber: shipment.referenceNumber,
      },
    });
    return mapShipment(shipment, ImportTradeParty.SELLER);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateImportShipmentDto,
  ) {
    const actor = await this.actors.resolve(user);
    const { shipment, party } = await this.loadForTrader(actor, id);
    this.assertSellerParty(party, actor);
    await this.applyDetails(shipment, dto, this.sellerActor(actor));
    return mapShipment(await this.reload(id), ImportTradeParty.SELLER);
  }

  async addEvent(
    user: AuthenticatedUser,
    id: string,
    dto: AddImportShipmentEventDto,
  ) {
    const actor = await this.actors.resolve(user);
    const { shipment, party } = await this.loadForTrader(actor, id);
    this.assertSellerParty(party, actor);
    await this.applyEvent(shipment, dto, this.sellerActor(actor));
    return mapShipment(await this.reload(id), ImportTradeParty.SELLER);
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  async adminList(query: AdminImportShipmentsQueryDto) {
    const where: Prisma.ImportShipmentWhereInput = {
      AND: [
        query.status ? { status: query.status } : {},
        query.exceptionsOnly === 'true'
          ? { status: ImportShipmentStatus.EXCEPTION }
          : {},
        query.dealId ? { dealId: query.dealId } : {},
        query.buyerOrgId ? { buyerOrgId: query.buyerOrgId } : {},
        query.sellerOrgId ? { sellerOrgId: query.sellerOrgId } : {},
        query.mode ? { mode: query.mode } : {},
        query.createdFrom || query.createdTo
          ? {
              createdAt: {
                ...(query.createdFrom
                  ? { gte: new Date(query.createdFrom) }
                  : {}),
                ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
              },
            }
          : {},
        this.searchWhere(resolveSearch(query)),
      ],
    };
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const [rows, total, byStatus] = await Promise.all([
      this.prisma.importShipment.findMany({
        where,
        include: SHIPMENT_INCLUDE,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.importShipment.count({ where }),
      this.prisma.importShipment.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);
    return {
      items: rows.map((s) => mapShipment(s, 'ADMIN')),
      meta: {
        ...paginationMeta(page, limit, total),
        countsByStatus: Object.fromEntries(
          byStatus.map((g) => [g.status, g._count._all]),
        ),
      },
    };
  }

  async adminGet(id: string) {
    const shipment = await this.prisma.importShipment.findUnique({
      where: { id },
      include: SHIPMENT_INCLUDE,
    });
    if (!shipment) throw new ImportException('SHIPMENT_NOT_FOUND');
    return mapShipment(shipment, 'ADMIN');
  }

  async adminUpdate(
    id: string,
    dto: UpdateImportShipmentDto,
    admin: { userId: string; role: string },
  ) {
    const shipment = await this.prisma.importShipment.findUnique({
      where: { id },
      include: SHIPMENT_INCLUDE,
    });
    if (!shipment) throw new ImportException('SHIPMENT_NOT_FOUND');
    await this.applyDetails(shipment, dto, {
      ...admin,
      party: ImportTradeParty.ADMIN,
    });
    return this.adminGet(id);
  }

  async adminAddEvent(
    id: string,
    dto: AddImportShipmentEventDto,
    admin: { userId: string; role: string },
  ) {
    const shipment = await this.prisma.importShipment.findUnique({
      where: { id },
      include: SHIPMENT_INCLUDE,
    });
    if (!shipment) throw new ImportException('SHIPMENT_NOT_FOUND');
    await this.applyEvent(shipment, dto, {
      ...admin,
      party: ImportTradeParty.ADMIN,
    });
    return this.adminGet(id);
  }

  // ---------------------------------------------------------------------------
  // Core
  // ---------------------------------------------------------------------------

  private reload(id: string) {
    return this.prisma.importShipment.findUniqueOrThrow({
      where: { id },
      include: SHIPMENT_INCLUDE,
    });
  }

  private async lockDeal(tx: Tx, dealId: string) {
    await tx.$queryRaw`SELECT id FROM import_deals WHERE id = ${dealId}::uuid FOR UPDATE`;
    return tx.importDeal.findUniqueOrThrow({ where: { id: dealId } });
  }

  private async allocated(tx: Tx, dealId: string) {
    const agg = await tx.importShipment.aggregate({
      where: { dealId, status: { in: [...ACTIVE_SHIPMENT_STATUSES] } },
      _sum: { quantity: true },
    });
    return agg._sum.quantity ?? new Prisma.Decimal(0);
  }

  private containers(values: string[] | undefined) {
    if (values === undefined) return undefined;
    return [
      ...new Set(values.map((v) => v.trim().toUpperCase()).filter(Boolean)),
    ];
  }

  private checkSchedule(
    etd: Date | null | undefined,
    eta: Date | null | undefined,
    errors: ImportFieldError[],
  ) {
    if (etd && eta && eta.getTime() < etd.getTime()) {
      errors.push({
        field: 'eta',
        code: 'INVALID_SHIPMENT_WINDOW',
        message: 'Estimated arrival cannot be before estimated departure.',
      });
    }
  }

  private async applyDetails(
    shipment: ShipmentRow,
    dto: UpdateImportShipmentDto,
    actor: ShipmentActor,
  ) {
    if (isTerminalShipment(shipment.status)) {
      throw new ImportException(
        'IMPORT_INVALID_STATUS_TRANSITION',
        `A ${humanize(shipment.status)} shipment can no longer be edited.`,
      );
    }
    if (dto.version !== undefined && dto.version !== shipment.version) {
      throw new ImportException('IMPORT_DRAFT_CONFLICT', undefined, {
        currentVersion: shipment.version,
      });
    }
    const data: Prisma.ImportShipmentUpdateManyMutationInput = {
      mode: dto.mode,
      carrierName: trimOrNull(dto.carrierName),
      trackingNumber: trimOrNull(dto.trackingNumber),
      vesselName: trimOrNull(dto.vesselName),
      voyageNumber: trimOrNull(dto.voyageNumber),
      containerNumbers: this.containers(dto.containerNumbers),
      originLocation: trimOrNull(dto.originLocation),
      destinationLocation: trimOrNull(dto.destinationLocation),
      etd: toInstant(dto.etd),
      eta: toInstant(dto.eta),
      remarks: trimOrNull(dto.remarks),
    };
    for (const k of Object.keys(data) as Array<keyof typeof data>) {
      if (data[k] === undefined) delete data[k];
    }
    const errors: ImportFieldError[] = [];
    this.checkSchedule(
      (data.etd as Date | null | undefined) ?? shipment.etd,
      (data.eta as Date | null | undefined) ?? shipment.eta,
      errors,
    );
    throwFieldErrors(errors);

    const norm = (v: unknown) =>
      v instanceof Date
        ? v.toISOString()
        : Array.isArray(v)
          ? v.join(',')
          : v === null || v === undefined
            ? null
            : String(v);
    const changed = (Object.keys(data) as Array<keyof typeof data>).filter(
      (k) =>
        norm(data[k]) !== norm(shipment[k as keyof ShipmentRow] as unknown),
    );
    if (!changed.length) return;

    const res = await this.prisma.importShipment.updateMany({
      where: { id: shipment.id, version: shipment.version },
      data: { ...data, updatedById: actor.userId, version: { increment: 1 } },
    });
    if (res.count === 0) throw new ImportException('IMPORT_DRAFT_CONFLICT');

    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.SHIPMENT_UPDATED,
      actorUserId: actor.userId,
      actorRole: actor.role,
      organizationId: shipment.sellerOrgId,
      entityType: EntityOwnerType.IMPORT_SHIPMENT,
      entityId: shipment.id,
      previousData: Object.fromEntries(
        changed.map((k) => [k, norm(shipment[k as keyof ShipmentRow])]),
      ),
      newData: Object.fromEntries(changed.map((k) => [k, norm(data[k])])),
      metadata: {
        referenceNumber: shipment.referenceNumber,
        dealId: shipment.dealId,
        actorParty: actor.party,
      },
    });
    const visible = changed.filter((k) =>
      ['carrierName', 'trackingNumber', 'vesselName', 'eta', 'etd'].includes(k),
    );
    if (visible.length) {
      await this.notifyParties(shipment, actor, {
        title: 'Import shipment details updated',
        body: `Shipment ${shipment.referenceNumber} updated its ${visible
          .map((k) =>
            k === 'eta'
              ? 'ETA'
              : k === 'etd'
                ? 'ETD'
                : humanize(k.replace(/([A-Z])/g, '_$1')),
          )
          .join(', ')}.`,
      });
    }
  }

  private async applyEvent(
    shipment: ShipmentRow,
    dto: AddImportShipmentEventDto,
    actor: ShipmentActor,
  ) {
    const now = new Date();
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : now;
    const target = dto.status ?? shipment.status;
    const transition = target !== shipment.status;
    const location = trimOrNull(dto.location) ?? null;
    const description = trimOrNull(dto.description) ?? null;

    const errors: ImportFieldError[] = [];
    if (occurredAt.getTime() > now.getTime() + CLOCK_SKEW_MS) {
      errors.push({
        field: 'occurredAt',
        code: 'IMPORT_VALIDATION_FAILED',
        message: 'Tracking events cannot be dated in the future.',
      });
    }
    if (occurredAt.getTime() < shipment.createdAt.getTime() - 30 * 86_400_000) {
      errors.push({
        field: 'occurredAt',
        code: 'IMPORT_VALIDATION_FAILED',
        message: 'Event date is too far before the shipment was booked.',
      });
    }
    if (!transition && !location && !description) {
      errors.push({
        field: 'description',
        code: 'REQUIRED',
        message: 'Add a location or note, or choose a new status.',
      });
    }
    if (target === ImportShipmentStatus.EXCEPTION && !description) {
      errors.push({
        field: 'description',
        code: 'REQUIRED',
        message:
          'Describe the exception so the buyer and Admin know what happened.',
      });
    }
    throwFieldErrors(errors);
    if (isTerminalShipment(shipment.status)) {
      throw new ImportException(
        'IMPORT_INVALID_STATUS_TRANSITION',
        `A ${humanize(shipment.status)} shipment cannot receive updates.`,
      );
    }
    if (transition) assertShipmentTransition(shipment.status, target);

    const fulfilment = await this.prisma.$transaction(async (tx) => {
      const deal = await this.lockDeal(tx, shipment.dealId);
      const res = await tx.importShipment.updateMany({
        where: {
          id: shipment.id,
          status: shipment.status,
          version: shipment.version,
        },
        data: {
          ...(transition
            ? { status: target, ...milestoneFields(target, occurredAt) }
            : {}),
          ...(target === ImportShipmentStatus.EXCEPTION && transition
            ? { exceptionReason: description }
            : {}),
          updatedById: actor.userId,
          version: { increment: 1 },
        },
      });
      if (res.count === 0) {
        throw new ImportException(
          'IMPORT_DRAFT_CONFLICT',
          'This shipment changed; refresh and try again.',
        );
      }
      await tx.importShipmentEvent.create({
        data: {
          shipmentId: shipment.id,
          status: target,
          previousStatus: transition ? shipment.status : null,
          location,
          description,
          occurredAt,
          actorParty: actor.party,
          actorUserId: actor.userId,
        },
      });
      if (
        !transition ||
        (target !== ImportShipmentStatus.DELIVERED &&
          target !== ImportShipmentStatus.CANCELLED)
      ) {
        return null;
      }
      return this.syncFulfilment(tx, deal);
    });

    await this.audit.log({
      action: transition
        ? IMPORT_AUDIT_ACTIONS.SHIPMENT_STATUS_CHANGED
        : IMPORT_AUDIT_ACTIONS.SHIPMENT_UPDATED,
      actorUserId: actor.userId,
      actorRole: actor.role,
      organizationId: shipment.sellerOrgId,
      entityType: EntityOwnerType.IMPORT_SHIPMENT,
      entityId: shipment.id,
      previousData: { status: shipment.status },
      newData: { status: target, location, description },
      metadata: {
        referenceNumber: shipment.referenceNumber,
        dealId: shipment.dealId,
        actorParty: actor.party,
        occurredAt,
      },
    });
    if (transition) {
      await this.notifyParties(shipment, actor, {
        title: `Import shipment ${humanize(target)}`,
        body: `Shipment ${shipment.referenceNumber} is now ${humanize(target)}${location ? ` at ${location}` : ''}${target === ImportShipmentStatus.EXCEPTION && description ? `: ${description}` : '.'}`,
        status: target,
      });
    }
    if (fulfilment) {
      await this.audit.log({
        action: IMPORT_AUDIT_ACTIONS.DEAL_FULFILMENT_CHANGED,
        actorUserId: actor.userId,
        actorRole: actor.role,
        organizationId: fulfilment.sellerOrgId,
        entityType: EntityOwnerType.IMPORT_DEAL,
        entityId: fulfilment.id,
        previousData: { status: fulfilment.from },
        newData: {
          status: fulfilment.to,
          deliveredQuantity: fulfilment.delivered,
        },
        metadata: {
          referenceNumber: fulfilment.referenceNumber,
          shipmentId: shipment.id,
        },
      });
      for (const org of [fulfilment.buyerOrgId, fulfilment.sellerOrgId]) {
        await this.notifier.notify({
          organizationId: org,
          event: IMPORT_NOTIFICATION_EVENTS.SHIPMENT_STATUS_CHANGED,
          title: 'Import deal delivery updated',
          body: `Deal ${fulfilment.referenceNumber} is now ${humanize(fulfilment.to)} (${fulfilment.delivered} delivered).`,
          entityType: EntityOwnerType.IMPORT_DEAL,
          entityId: fulfilment.id,
          metadata: { dealId: fulfilment.id, status: fulfilment.to },
        });
      }
    }
  }

  /** Moves the deal (and its listings) to partially/fully fulfilled from delivered quantity. */
  private async syncFulfilment(
    tx: Tx,
    deal: Awaited<ReturnType<ImportShipmentsService['lockDeal']>>,
  ) {
    const agg = await tx.importShipment.aggregate({
      where: { dealId: deal.id, status: ImportShipmentStatus.DELIVERED },
      _sum: { quantity: true },
    });
    const delivered = agg._sum.quantity ?? new Prisma.Decimal(0);
    const to = fulfilmentStatus(deal.status, deal.quantity, delivered);
    if (!to) return null;
    await tx.importDeal.update({
      where: { id: deal.id },
      data: { status: to },
    });
    const listingTarget =
      to === ImportDealStatus.FULFILLED
        ? ImportListingStatus.FULFILLED
        : ImportListingStatus.PARTIALLY_FULFILLED;
    for (const listingId of [deal.buyListingId, deal.sellListingId]) {
      if (!listingId) continue;
      const l = await tx.importListing.findUnique({
        where: { id: listingId },
        select: { status: true },
      });
      if (l && canTransition(l.status, listingTarget)) {
        await tx.importListing.update({
          where: { id: listingId },
          data: { status: listingTarget },
        });
      }
    }
    return {
      id: deal.id,
      referenceNumber: deal.referenceNumber,
      buyerOrgId: deal.buyerOrgId,
      sellerOrgId: deal.sellerOrgId,
      from: deal.status,
      to,
      delivered: `${decimalString(delivered)} ${deal.quantityUnit}`,
    };
  }

  /** The buyer always hears about changes; the seller too when Admin made them. */
  private async notifyParties(
    shipment: ShipmentRow,
    actor: ShipmentActor,
    notice: { title: string; body: string; status?: ImportShipmentStatus },
  ) {
    const orgs =
      actor.party === ImportTradeParty.ADMIN
        ? [shipment.buyerOrgId, shipment.sellerOrgId]
        : [shipment.buyerOrgId];
    for (const org of orgs) {
      await this.notifier.notify({
        organizationId: org,
        event: IMPORT_NOTIFICATION_EVENTS.SHIPMENT_STATUS_CHANGED,
        title: notice.title,
        body: notice.body,
        entityType: EntityOwnerType.IMPORT_SHIPMENT,
        entityId: shipment.id,
        excludeUserId: actor.userId,
        metadata: {
          shipmentId: shipment.id,
          dealId: shipment.dealId,
          referenceNumber: shipment.referenceNumber,
          ...(notice.status ? { status: notice.status } : {}),
        },
      });
    }
  }
}
