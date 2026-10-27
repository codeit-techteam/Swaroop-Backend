import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import {
  GradeStatus,
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

type GradeLabelSource = {
  fullGradeName?: string | null;
  displayName?: string | null;
  gradeGroup?: string | null;
  gradeNo?: string | null;
  name?: string | null;
  manufacturer?: string | null;
};

/** True for internal Grade Master codes like MASTERBATCH_BLACK / COMPOUND_ABS_FR. */
export function isInternalGradeCode(value?: string | null): boolean {
  if (!value) return false;
  return /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(value.trim());
}

/**
 * Best verified listing title from Grade Master — never invents values.
 * Prefer fullGradeName → specific product name → displayName → "group + gradeNo".
 *
 * Product name wins over a shorter/generic grade label so white TiO2 masterbatch
 * (B-05) is not retitled "Masterbatch" just because it was linked to a black-MB grade.
 */
export function listingDisplayName(
  productName: string,
  grade?: GradeLabelSource | null,
): string {
  const full = grade?.fullGradeName?.trim();
  if (full) return full;

  const product = productName?.trim() || '';
  const display = grade?.displayName?.trim() || '';
  // Prefer the commercial product title when it carries more detail than the grade label
  // (e.g. "White Masterbatch TiO2 50%" vs generic "Masterbatch").
  if (product && (!display || product.length > display.length)) {
    return product;
  }
  if (display && !isInternalGradeCode(display)) return display;

  const composed = [grade?.gradeGroup, grade?.gradeNo]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p) && !isInternalGradeCode(p))
    .join(' ')
    .trim();
  if (composed) return composed;

  const gradeName = grade?.name?.trim() || '';
  if (gradeName && !isInternalGradeCode(gradeName)) return gradeName;
  return product || display || gradeName;
}

export function listingManufacturer(
  productManufacturer: string | null | undefined,
  productBrand: string | null | undefined,
  grade?: GradeLabelSource | null,
): string | null {
  return (
    productManufacturer?.trim() ||
    grade?.manufacturer?.trim() ||
    productBrand?.trim() ||
    null
  );
}

type BlindDedupeProduct = {
  id: string;
  code?: string;
  grade?: { id?: string; code?: string } | null;
  technicalSpecs?: unknown;
  listing?: {
    price?: unknown;
    moq?: unknown;
    leadTime?: string | null;
    quantityAvailable?: unknown;
  } | null;
};

/**
 * B-06: collapse indistinguishable marketplace cards.
 * Keeps distinct commercial offers (different price / MOQ / origin / ETA / warehouse).
 * When two listings are commercially identical (common with multi-seller demo seeds),
 * keep the one with more available stock.
 */
export function dedupeBlindProducts<T extends BlindDedupeProduct>(
  products: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const product of products) {
    if (!byId.has(product.id)) byId.set(product.id, product);
  }
  const unique = [...byId.values()];

  const fingerprint = (product: T): string => {
    const specs =
      product.technicalSpecs && typeof product.technicalSpecs === 'object'
        ? (product.technicalSpecs as Record<string, unknown>)
        : {};
    const origin = String(specs.origin ?? '').trim().toLowerCase();
    const warehouse = String(specs.warehouseLabel ?? '').trim().toLowerCase();
    const gradeKey =
      product.grade?.id || product.grade?.code || product.code || product.id;
    const price = Number(product.listing?.price ?? 0);
    const moq = Number(product.listing?.moq ?? 0);
    const eta = String(product.listing?.leadTime ?? specs.eta ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');
    return [gradeKey, price, moq, origin, warehouse, eta].join('::');
  };

  const bestByFingerprint = new Map<string, T>();
  for (const product of unique) {
    const key = fingerprint(product);
    const previous = bestByFingerprint.get(key);
    const stock = Number(product.listing?.quantityAvailable ?? 0);
    const previousStock = Number(previous?.listing?.quantityAvailable ?? 0);
    if (!previous || stock > previousStock) {
      bestByFingerprint.set(key, product);
    }
  }

  const keep = new Set(
    [...bestByFingerprint.values()].map((product) => product.id),
  );
  return unique.filter((product) => keep.has(product.id));
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
    fullGradeName?: string | null;
    gradeNo?: string | null;
    gradeGroup?: string | null;
    manufacturer?: string | null;
    category?: {
      id: string;
      code: string;
      name: string;
      parentGroup?: string | null;
    } | null;
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
  const manufacturer = listingManufacturer(
    product.manufacturer,
    product.brand,
    product.grade,
  );
  return {
    id: product.id,
    code: product.code,
    name: listingDisplayName(product.name, product.grade),
    brand: manufacturer,
    manufacturer,
    description: product.description,
    technicalSpecs: product.technicalSpecs,
    // Only surface MFI when present on the verified product record.
    mfi: product.mfi?.trim() || null,
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
          fullGradeName: product.grade.fullGradeName ?? null,
          gradeNo: product.grade.gradeNo ?? null,
          gradeGroup: product.grade.gradeGroup ?? null,
          manufacturer: product.grade.manufacturer ?? null,
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
    manufacturer?: string | null;
    brand?: string | null;
  } | null;
  grade?: {
    id: string;
    code: string;
    name: string;
    displayName: string | null;
    fullGradeName?: string | null;
    gradeNo?: string | null;
    gradeGroup?: string | null;
    manufacturer?: string | null;
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
          name: listingDisplayName(offer.product.name, offer.grade),
          unit: offer.product.unit,
          manufacturer: listingManufacturer(
            offer.product.manufacturer,
            offer.product.brand,
            offer.grade,
          ),
        }
      : null,
    grade: offer.grade
      ? {
          id: offer.grade.id,
          code: offer.grade.code,
          name: offer.grade.name,
          displayName: offer.grade.displayName ?? offer.grade.name,
          fullGradeName: offer.grade.fullGradeName ?? null,
          gradeNo: offer.grade.gradeNo ?? null,
          gradeGroup: offer.grade.gradeGroup ?? null,
          manufacturer: offer.grade.manufacturer ?? null,
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
  const commercialTiers = commercialPriceTiers(
    offer.priceTiers,
    offer.metadata,
  ).sort((a, b) => Number(a.minQty) - Number(b.minQty));
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
    grade?: {
      status?: GradeStatus;
      customerVisible?: boolean;
      deletedAt?: Date | null;
    } | null;
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
  if (
    offer.grade &&
    (offer.grade.deletedAt ||
      (offer.grade.status !== undefined &&
        offer.grade.status !== GradeStatus.ACTIVE) ||
      offer.grade.customerVisible === false)
  ) {
    throw new MarketplaceException(
      'PRODUCT_NOT_AVAILABLE',
      'This grade is no longer available on the marketplace',
    );
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
