import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import {
  OfferStatus,
  ProductStatus,
  type Offer,
  type OfferPriceTier,
} from '../../../generated/prisma/client.js';
import { isPlatformCredit } from '../../payments/common/platform-credit.js';

export class MarketplaceException extends BadRequestException {
  constructor(code: string, message?: string) {
    super({ code, message: message ?? code });
  }
}

export function anonymousSupplierRef(organizationId: string): string {
  const hash = createHash('sha256').update(organizationId).digest('hex');
  return `SUP-${hash.slice(0, 8).toUpperCase()}`;
}

/** Blind-safe ETA when offer.deliveryTerms is missing. */
export function estimateLeadTime(locationHint?: string | null): string {
  const hint = (locationHint ?? '').toLowerCase();
  if (
    hint.includes('mumbai') ||
    hint.includes('pune') ||
    hint.includes('nashik') ||
    hint.includes('gujarat') ||
    hint.includes('ahmedabad')
  ) {
    return '2–3 Business Days';
  }
  if (
    hint.includes('chennai') ||
    hint.includes('kolkata') ||
    hint.includes('howrah') ||
    hint.includes('delhi') ||
    hint.includes('hyderabad') ||
    hint.includes('bangalore') ||
    hint.includes('bengaluru')
  ) {
    return '3–5 Business Days';
  }
  return '4–6 Business Days';
}

function warehouseHintFromSpecs(technicalSpecs: unknown): string | null {
  if (!technicalSpecs || typeof technicalSpecs !== 'object') return null;
  const label = (technicalSpecs as Record<string, unknown>).warehouseLabel;
  return typeof label === 'string' ? label : null;
}

function inactiveTierIds(metadata: unknown): Set<string> {
  if (!metadata || typeof metadata !== 'object') return new Set();
  const raw = (metadata as Record<string, unknown>).inactivePriceTier;
  if (!Array.isArray(raw)) return new Set();
  return new Set(
    raw.filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
}

function commercialPriceTiers<
  T extends {
    id?: string;
    minQty: unknown;
    maxQty: unknown;
    price: unknown;
    currency?: string;
    paymentMethod?: string | null;
  },
>(tiers: T[] | undefined, metadata?: unknown): T[] {
  const inactive = inactiveTierIds(metadata);
  return [...(tiers ?? [])].filter((tier) => {
    if (tier.id && inactive.has(tier.id)) return false;
    if (isPlatformCredit(tier.paymentMethod)) return false;
    return true;
  });
}

export function toBlindProduct(product: {
  id: string;
  code: string;
  name: string;
  brand: string | null;
  manufacturer?: string | null;
  description: string | null;
  technicalSpecs: unknown;
  mfi: string | null;
  density: string | null;
  packaging: string | null;
  unit: string;
  countryOfOrigin: string | null;
  supplyOrigin: string | null;
  status: string;
  grade?: {
    id: string;
    code: string;
    name: string;
    displayName: string | null;
    category?: { id: string; code: string; name: string } | null;
  } | null;
  media?: Array<{
    id: string;
    type: string;
    sortOrder: number;
    fileName: string | null;
  }>;
  offers?: Array<{
    id: string;
    quantity?: unknown;
    moq?: unknown;
    unit?: string;
    basePrice?: unknown;
    currency?: string;
    deliveryTerms?: string | null;
    organizationId?: string;
    metadata?: unknown;
    priceTiers?: Array<{
      id?: string;
      minQty: unknown;
      maxQty: unknown;
      price: unknown;
      currency?: string;
      paymentMethod?: string | null;
    }>;
  }>;
}) {
  const offer = product.offers?.[0];
  const warehouseHint = warehouseHintFromSpecs(product.technicalSpecs);
  const tiers = commercialPriceTiers(offer?.priceTiers, offer?.metadata);
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    brand: product.brand ?? product.manufacturer ?? null,
    manufacturer: product.manufacturer ?? product.brand ?? null,
    description: product.description,
    technicalSpecs: product.technicalSpecs,
    mfi: product.mfi,
    density: product.density,
    packaging: product.packaging,
    unit: product.unit,
    countryOfOrigin: product.countryOfOrigin,
    supplyOrigin: product.supplyOrigin,
    status: product.status,
    grade: product.grade
      ? {
          id: product.grade.id,
          code: product.grade.code,
          name: product.grade.name,
          displayName: product.grade.displayName ?? product.grade.name,
          category: product.grade.category ?? null,
        }
      : null,
    media: (product.media ?? []).map((m) => ({
      id: m.id,
      type: m.type,
      sortOrder: m.sortOrder,
      fileName: m.fileName,
    })),
    listing: offer
      ? {
          offerId: offer.id,
          price: offer.basePrice,
          currency: offer.currency ?? 'INR',
          unit: offer.unit ?? product.unit,
          moq: offer.moq,
          quantityAvailable: offer.quantity,
          leadTime:
            offer.deliveryTerms?.trim() ||
            estimateLeadTime(warehouseHint ?? product.countryOfOrigin),
          priceTiers: tiers.map((t) => ({
            minQty: t.minQty,
            maxQty: t.maxQty,
            price: t.price,
            currency: t.currency ?? offer.currency ?? 'INR',
          })),
        }
      : null,
    supplier: {
      displayName: 'ANONYMOUS SUPPLIER',
    },
  };
}

export function toBlindOffer(offer: {
  id: string;
  referenceNumber: string;
  quantity: unknown;
  moq: unknown;
  unit: string;
  basePrice: unknown;
  currency: string;
  pricingBasis: string | null;
  paymentTerms: unknown;
  deliveryTerms: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
  status: string;
  organizationId: string;
  metadata?: unknown;
  product?: {
    id: string;
    code: string;
    name: string;
    packaging: string | null;
    unit: string;
  } | null;
  grade?: {
    id: string;
    code: string;
    name: string;
    displayName: string | null;
  } | null;
  warehouse?: {
    city: string | null;
    state: string | null;
    country: string;
  } | null;
  priceTiers?: Array<{
    minQty: unknown;
    maxQty: unknown;
    price: unknown;
    currency: string;
    paymentMethod: string | null;
  }>;
}) {
  const metadata =
    offer.metadata && typeof offer.metadata === 'object'
      ? (offer.metadata as Record<string, unknown>)
      : {};
  const gstRaw = metadata.gstPercent;
  const gstPercent =
    typeof gstRaw === 'number'
      ? gstRaw
      : typeof gstRaw === 'string'
        ? Number(gstRaw)
        : undefined;

  return {
    id: offer.id,
    referenceNumber: offer.referenceNumber,
    quantityAvailable: offer.quantity,
    moq: offer.moq,
    unit: offer.unit,
    price: offer.basePrice,
    currency: offer.currency,
    pricingBasis: offer.pricingBasis,
    paymentTerms: offer.paymentTerms,
    deliveryTerms: offer.deliveryTerms,
    validFrom: offer.validFrom,
    validUntil: offer.validUntil,
    status: offer.status,
    gstPercent:
      gstPercent != null && Number.isFinite(gstPercent) ? gstPercent : 18,
    packaging: offer.product?.packaging ?? null,
    region:
      offer.warehouse?.state || offer.warehouse?.city
        ? [offer.warehouse.city, offer.warehouse.state, offer.warehouse.country]
            .filter(Boolean)
            .join(', ')
        : null,
    product: offer.product
      ? {
          id: offer.product.id,
          code: offer.product.code,
          name: offer.product.name,
          unit: offer.product.unit,
        }
      : null,
    grade: offer.grade
      ? {
          id: offer.grade.id,
          code: offer.grade.code,
          name: offer.grade.name,
          displayName: offer.grade.displayName ?? offer.grade.name,
        }
      : null,
    priceTiers: commercialPriceTiers(offer.priceTiers, offer.metadata).map(
      (t) => ({
        minQty: t.minQty,
        maxQty: t.maxQty,
        price: t.price,
        currency: t.currency,
        paymentMethod: t.paymentMethod,
      }),
    ),
    supplier: {
      displayName: 'ANONYMOUS SUPPLIER',
      reference: anonymousSupplierRef(offer.organizationId),
    },
  };
}

export function resolveOfferUnitPrice(
  offer: Offer & { priceTiers?: OfferPriceTier[] },
  quantity: number,
): Offer['basePrice'] {
  const commercialTiers = commercialPriceTiers(offer.priceTiers, offer.metadata).sort(
    (a, b) => Number(a.minQty) - Number(b.minQty),
  );
  for (const tier of commercialTiers) {
    const min = Number(tier.minQty);
    const max = tier.maxQty == null ? Infinity : Number(tier.maxQty);
    if (quantity >= min && quantity <= max) {
      return tier.price;
    }
  }
  return offer.basePrice;
}

export function assertMarketplaceOffer(
  offer: {
    status: OfferStatus;
    validUntil: Date | null;
    validFrom: Date | null;
    deletedAt?: Date | null;
    visibility?: string | null;
    product?: { status: ProductStatus; deletedAt: Date | null } | null;
  },
  quantity: number,
  moq: unknown,
) {
  if (offer.deletedAt) {
    throw new MarketplaceException('OFFER_NOT_FOUND');
  }
  if (offer.status !== OfferStatus.ACTIVE) {
    throw new MarketplaceException('OFFER_NOT_ACTIVE');
  }
  if (offer.visibility && offer.visibility !== 'MARKETPLACE') {
    throw new MarketplaceException(
      'OFFER_NOT_ACTIVE',
      'Offer not marketplace visible',
    );
  }
  const now = new Date();
  if (offer.validUntil && offer.validUntil < now) {
    throw new MarketplaceException('OFFER_EXPIRED');
  }
  if (offer.validFrom && offer.validFrom > now) {
    throw new MarketplaceException('OFFER_NOT_ACTIVE', 'Offer not yet valid');
  }
  if (
    !offer.product ||
    offer.product.deletedAt ||
    offer.product.status !== ProductStatus.ACTIVE
  ) {
    throw new MarketplaceException('PRODUCT_NOT_AVAILABLE');
  }
  if (!(quantity > 0)) {
    throw new MarketplaceException(
      'QUANTITY_BELOW_MOQ',
      'Quantity must be greater than 0',
    );
  }
  const moqNum = moq == null ? 0 : Number(moq);
  if (quantity < moqNum) {
    throw new MarketplaceException('QUANTITY_BELOW_MOQ');
  }
}

export function assertAvailability(offerQuantity: unknown, requested: number) {
  const available = Number(offerQuantity);
  if (Number.isFinite(available) && requested > available) {
    throw new MarketplaceException('QUANTITY_EXCEEDS_AVAILABILITY');
  }
}

export function toCustomerFacingPr(
  pr: {
    id: string;
    referenceNumber: string;
    status: string;
    paymentMethod: string | null;
    targetPrice: unknown;
    currency: string;
    requiredByDate: Date | null;
    destinationRegion: string | null;
    notes: string | null;
    expiresAt: Date | null;
    responseDeadline: Date | null;
    submittedAt: Date | null;
    createdAt: Date;
    rejectionReason: string | null;
    sellerOrgId: string | null;
    commerciallyAcceptedAt?: Date | null;
    commercialSnapshot?: unknown;
    items?: Array<{
      id: string;
      quantity: unknown;
      unit: string;
      targetUnitPrice: unknown;
      unitPriceSnapshot: unknown;
      paymentMethod: string | null;
      packaging: string | null;
      offerId: string | null;
      grade?: {
        id: string;
        code: string;
        name: string;
        displayName: string | null;
      } | null;
      product?: { id: string; code: string; name: string } | null;
      offer?: { id: string; referenceNumber: string } | null;
    }>;
    responses?: Array<{
      id: string;
      type: string;
      message: string | null;
      counterPrice: unknown;
      counterQuantity: unknown;
      currency: string;
      validUntil: Date | null;
      createdAt: Date;
    }>;
    purchaseOrders?: Array<{
      referenceNumber: string;
      status: string;
    }>;
    counterOffers?: Array<{
      roundNumber: number;
      createdByRole: string;
      unitPrice: unknown;
      quantity: unknown;
      paymentMethod: string | null;
      currency: string;
      status: string;
      validUntil: Date | null;
      note: string | null;
      createdAt: Date;
      respondedAt?: Date | null;
    }>;
  },
  extras?: {
    remainingSeconds?: number | null;
    allowedActions?: string[];
    poNumber?: string | null;
  },
) {
  const deadline = pr.responseDeadline ?? pr.expiresAt;
  const po = pr.purchaseOrders?.[0];
  const poNumber = extras?.poNumber ?? po?.referenceNumber ?? null;

  return {
    id: pr.id,
    referenceNumber: pr.referenceNumber,
    status: pr.status,
    paymentMethod: pr.paymentMethod,
    targetPrice: pr.targetPrice,
    currency: pr.currency,
    requiredByDate: pr.requiredByDate,
    destinationRegion: pr.destinationRegion,
    notes: pr.notes,
    expiresAt: pr.expiresAt,
    responseDeadline: deadline,
    remainingSeconds:
      extras?.remainingSeconds ??
      (deadline
        ? Math.max(0, Math.floor((deadline.getTime() - Date.now()) / 1000))
        : null),
    allowedActions: extras?.allowedActions ?? [],
    commerciallyAcceptedAt: pr.commerciallyAcceptedAt ?? null,
    poNumber,
    purchaseOrder: poNumber
      ? { referenceNumber: poNumber, status: po?.status ?? null }
      : null,
    commercial: pr.commercialSnapshot ?? null,
    submittedAt: pr.submittedAt,
    createdAt: pr.createdAt,
    rejectionReason: pr.rejectionReason,
    supplier: {
      displayName: 'ANONYMOUS SUPPLIER',
      reference: pr.sellerOrgId ? anonymousSupplierRef(pr.sellerOrgId) : null,
    },
    items: (pr.items ?? []).map((item) => ({
      id: item.id,
      quantity: item.quantity,
      unit: item.unit,
      unitPriceSnapshot: item.unitPriceSnapshot ?? item.targetUnitPrice,
      paymentMethod: item.paymentMethod,
      packaging: item.packaging,
      offer: item.offer
        ? {
            id: item.offer.id,
            referenceNumber: item.offer.referenceNumber,
          }
        : item.offerId
          ? { id: item.offerId }
          : null,
      grade: item.grade
        ? {
            id: item.grade.id,
            code: item.grade.code,
            name: item.grade.name,
            displayName: item.grade.displayName ?? item.grade.name,
          }
        : null,
      product: item.product
        ? {
            id: item.product.id,
            code: item.product.code,
            name: item.product.name,
          }
        : null,
    })),
    responses: (pr.responses ?? []).map((r) => ({
      id: r.id,
      type: r.type,
      message: r.message,
      counterPrice: r.counterPrice,
      counterQuantity: r.counterQuantity,
      currency: r.currency,
      validUntil: r.validUntil,
      createdAt: r.createdAt,
    })),
    counterOffers: (pr.counterOffers ?? []).map((c) => ({
      roundNumber: c.roundNumber,
      role: c.createdByRole,
      unitPrice: c.unitPrice,
      quantity: c.quantity,
      paymentMethod: c.paymentMethod,
      currency: c.currency,
      status: c.status,
      validUntil: c.validUntil,
      note: c.note,
      createdAt: c.createdAt,
      respondedAt: c.respondedAt ?? null,
    })),
  };
}
