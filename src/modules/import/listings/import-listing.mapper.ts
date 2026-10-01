import { createHash } from 'node:crypto';
import {
  ImportListingStatus,
  ImportSide,
  Prisma,
} from '../../../generated/prisma/client.js';
import { decimalString } from '../domain/import-decimal.js';
import { allowedTransitions } from '../domain/import-status.machine.js';
import { estimateEta } from '../domain/import-validation.js';
import type { ListingSnapshot } from '../common/import-master.service.js';

const named = { select: { id: true, code: true, name: true } } as const;

export const LISTING_INCLUDE = {
  category: { select: { id: true, code: true, name: true, displayName: true } },
  grade: {
    select: {
      id: true,
      code: true,
      name: true,
      displayName: true,
      categoryId: true,
    },
  },
  brand: named,
  originCountry: named,
  packaging: named,
  currency: {
    select: {
      id: true,
      code: true,
      name: true,
      symbol: true,
      decimalPlaces: true,
    },
  },
  incoterm: { select: { id: true, code: true, name: true, priceBasis: true } },
  priceBasisPort: {
    select: { id: true, code: true, name: true, countryCode: true },
  },
  paymentTerm: {
    select: {
      id: true,
      code: true,
      name: true,
      displayName: true,
      method: true,
      currencyCodes: true,
    },
  },
  pol: { select: { id: true, code: true, name: true, countryCode: true } },
  pod: { select: { id: true, code: true, name: true, countryCode: true } },
  documentRequirements: {
    include: {
      documentRequirement: {
        select: { id: true, code: true, name: true, documentCategory: true },
      },
    },
  },
} satisfies Prisma.ImportListingInclude;

export type ListingWithRelations = Prisma.ImportListingGetPayload<{
  include: typeof LISTING_INCLUDE;
}>;

export type ListingView = 'owner' | 'market' | 'admin';

/**
 * Stable, non-reversible alias for an organisation inside Import. Salted with a
 * module prefix so it never correlates with domestic marketplace aliases.
 */
export function importPartyRef(
  side: 'BUYER' | 'SELLER',
  orgId: string,
): string {
  const hash = createHash('sha256')
    .update(`import:${side}:${orgId}`)
    .digest('hex');
  return `${side}-${hash.slice(0, 8).toUpperCase()}`;
}

function liveSnapshot(l: ListingWithRelations): ListingSnapshot {
  return {
    capturedAt: l.updatedAt.toISOString(),
    category: l.category
      ? {
          id: l.category.id,
          code: l.category.code,
          name: l.category.displayName ?? l.category.name,
        }
      : null,
    grade: l.grade
      ? {
          id: l.grade.id,
          code: l.grade.code,
          name: l.grade.displayName ?? l.grade.name,
          categoryId: l.grade.categoryId,
        }
      : null,
    customGradeName: l.customGradeName,
    brand: l.brand,
    originCountry: l.originCountry,
    packaging: l.packaging,
    currency: l.currency
      ? {
          id: l.currency.id,
          code: l.currency.code,
          name: l.currency.name,
          symbol: l.currency.symbol,
          decimalPlaces: l.currency.decimalPlaces,
        }
      : null,
    incoterm: l.incoterm,
    priceBasisPort: l.priceBasisPort,
    paymentTerm: l.paymentTerm
      ? {
          id: l.paymentTerm.id,
          code: l.paymentTerm.code,
          name: l.paymentTerm.displayName ?? l.paymentTerm.name,
          method: l.paymentTerm.method,
          currencyCodes: l.paymentTerm.currencyCodes,
        }
      : null,
    pol: l.pol,
    pod: l.pod,
    documentRequirements: l.documentRequirements.map(
      (d) => d.documentRequirement,
    ),
  };
}

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function mapListing(
  l: ListingWithRelations,
  view: ListingView,
  extras: { now?: Date } = {},
) {
  const now = extras.now ?? new Date();
  // Published listings display the names captured at publish, so later master
  // edits never rewrite a live or historic trade.
  const names =
    l.status !== ImportListingStatus.DRAFT && l.snapshot
      ? (l.snapshot as unknown as ListingSnapshot)
      : liveSnapshot(l);
  const isOwner = view === 'owner' || view === 'admin';
  const partyKind = l.side === ImportSide.BUY ? 'BUYER' : 'SELLER';

  return {
    id: l.id,
    referenceNumber: l.referenceNumber,
    side: l.side,
    status: l.status,
    source: l.source,
    version: l.version,
    counterpartyRef: importPartyRef(partyKind, l.ownerOrgId),
    ...(isOwner ? { allowedTransitions: allowedTransitions(l.status) } : {}),

    product: {
      categoryId: l.categoryId,
      category: names.category,
      gradeId: l.gradeId,
      grade: names.grade,
      customGradeName: l.customGradeName,
      brandId: l.brandId,
      brand: names.brand,
      originCountryId: l.originCountryId,
      originCountry: names.originCountry,
      quantity: decimalString(l.quantity),
      quantityUnit: l.quantityUnit,
      packagingId: l.packagingId,
      packaging: names.packaging,
      application: l.application,
      hsCode: l.hsCode,
      casNumber: l.casNumber,
    },
    commercial: {
      price: decimalString(l.price),
      currencyId: l.currencyId,
      currencyCode: l.currencyCode,
      currency: names.currency,
      priceUnit: l.priceUnit,
      priceType: l.priceType,
      incotermId: l.incotermId,
      incoterm: names.incoterm,
      priceBasisPortId: l.priceBasisPortId,
      priceBasisPort: names.priceBasisPort,
      priceBasisLocation: l.priceBasisLocation,
      paymentTermId: l.paymentTermId,
      paymentTerm: names.paymentTerm,
      gstTreatment: l.gstTreatment,
    },
    shipping: {
      polId: l.polId,
      pol: names.pol,
      podId: l.podId,
      pod: names.pod,
      esd: dateOnly(l.esd),
      lsd: dateOnly(l.lsd),
      transitMinDays: l.transitMinDays,
      transitMaxDays: l.transitMaxDays,
      estimatedEta: estimateEta(l),
      partialShipment: l.partialShipment,
      transshipment: l.transshipment,
      shipmentType: l.shipmentType,
      containerSize: l.containerSize,
      containerCount: l.containerCount,
    },
    quality: {
      specification: l.specification,
      inspectionType: l.inspectionType,
      documentRequirementIds: l.documentRequirements.map(
        (d) => d.documentRequirementId,
      ),
      documentRequirements: names.documentRequirements,
    },
    buyTerms:
      l.side === ImportSide.BUY
        ? {
            acceptableQuantityMin: decimalString(l.acceptableQuantityMin),
            acceptableQuantityMax: decimalString(l.acceptableQuantityMax),
            requiredDeliveryDate: dateOnly(l.requiredDeliveryDate),
            specialRequirements: l.specialRequirements,
          }
        : null,
    sellTerms:
      l.side === ImportSide.SELL
        ? {
            moq: decimalString(l.moq),
            maximumQuantity: decimalString(l.maximumQuantity),
            readyStockType: l.readyStockType,
          }
        : null,
    remarks: l.remarks,
    validity: {
      validFrom: l.validFrom,
      validUntil: l.validUntil,
      serverTime: now,
      isExpired: !!l.validUntil && l.validUntil <= now,
      secondsRemaining: l.validUntil
        ? Math.max(
            0,
            Math.floor((l.validUntil.getTime() - now.getTime()) / 1000),
          )
        : null,
    },
    publishedAt: l.publishedAt,
    pausedAt: l.pausedAt,
    cancelledAt: l.cancelledAt,
    expiredAt: l.expiredAt,
    ...(isOwner ? { cancelReason: l.cancelReason, rawInput: l.rawInput } : {}),
    ...(view === 'admin'
      ? {
          ownerOrgId: l.ownerOrgId,
          customerProfileId: l.customerProfileId,
          sellerProfileId: l.sellerProfileId,
          createdById: l.createdById,
          extraction: l.extraction,
        }
      : {}),
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

export type MappedListing = ReturnType<typeof mapListing>;
