import { ImportTradeParty, Prisma } from '../../../generated/prisma/client.js';
import { decimalString } from '../domain/import-decimal.js';
import { shipmentTransitions } from '../domain/import-shipment.machine.js';
import { importPartyRef } from '../listings/import-listing.mapper.js';
import type { ListingSnapshot } from '../common/import-master.service.js';

export const SHIPMENT_INCLUDE = {
  deal: {
    select: {
      id: true,
      referenceNumber: true,
      status: true,
      quantity: true,
      quantityUnit: true,
      sellListing: { select: { snapshot: true } },
      buyListing: { select: { snapshot: true } },
    },
  },
  buyerOrg: { select: { id: true, name: true, legalName: true } },
  sellerOrg: { select: { id: true, name: true, legalName: true } },
  events: { orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.ImportShipmentInclude;

export type ShipmentRow = Prisma.ImportShipmentGetPayload<{
  include: typeof SHIPMENT_INCLUDE;
}>;

export type ShipmentView = ImportTradeParty;

/** "LDPE · Lotrene FD0274" from the listing snapshot frozen at publish. */
function productLabel(deal: ShipmentRow['deal']): string | null {
  const snap = (deal.sellListing?.snapshot ?? deal.buyListing?.snapshot) as
    (ListingSnapshot | null) | undefined;
  if (!snap) return null;
  const grade = snap.grade?.name ?? snap.customGradeName;
  return [snap.category?.name, grade].filter(Boolean).join(' · ') || null;
}

/**
 * Role-specific shipment payload. Traders get carrier/tracking data and the
 * event timeline but never internal user ids; Admin also sees both parties.
 */
export function mapShipment(s: ShipmentRow, view: ShipmentView) {
  const isAdmin = view === ImportTradeParty.ADMIN;
  const canManage = isAdmin || view === ImportTradeParty.SELLER;
  const org = (o: ShipmentRow['buyerOrg']) => ({
    id: o.id,
    name: o.legalName ?? o.name,
  });
  return {
    id: s.id,
    referenceNumber: s.referenceNumber,
    status: s.status,
    mode: s.mode,
    myParty: view,
    canManage,
    ...(canManage ? { allowedTransitions: shipmentTransitions(s.status) } : {}),
    deal: {
      id: s.deal.id,
      referenceNumber: s.deal.referenceNumber,
      status: s.deal.status,
      quantity: decimalString(s.deal.quantity),
      quantityUnit: s.deal.quantityUnit,
      product: productLabel(s.deal),
    },
    buyerRef: importPartyRef('BUYER', s.buyerOrgId),
    sellerRef: importPartyRef('SELLER', s.sellerOrgId),
    ...(isAdmin
      ? {
          buyer: org(s.buyerOrg),
          seller: org(s.sellerOrg),
          createdById: s.createdById,
          updatedById: s.updatedById,
        }
      : {}),
    quantity: decimalString(s.quantity),
    quantityUnit: s.quantityUnit,
    carrierName: s.carrierName,
    trackingNumber: s.trackingNumber,
    vesselName: s.vesselName,
    voyageNumber: s.voyageNumber,
    containerNumbers: s.containerNumbers,
    originLocation: s.originLocation,
    destinationLocation: s.destinationLocation,
    etd: s.etd,
    eta: s.eta,
    departedAt: s.departedAt,
    arrivedAt: s.arrivedAt,
    deliveredAt: s.deliveredAt,
    cancelledAt: s.cancelledAt,
    exceptionReason: s.exceptionReason,
    remarks: s.remarks,
    version: s.version,
    events: s.events.map((e) => ({
      id: e.id,
      status: e.status,
      previousStatus: e.previousStatus,
      location: e.location,
      description: e.description,
      occurredAt: e.occurredAt,
      actorParty: e.actorParty,
      source: e.source,
      ...(isAdmin ? { actorUserId: e.actorUserId, metadata: e.metadata } : {}),
    })),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export type MappedShipment = ReturnType<typeof mapShipment>;
