export type OfferPriceTierRange = {
  minQty: number;
  maxQty?: number | null;
  price: number;
};

/**
 * Validates bulk pricing slabs: positive quantities/prices and no overlapping ranges.
 * Open-ended maxQty (null/undefined) is treated as Infinity.
 */
export function assertNonOverlappingPriceTiers(
  tiers: OfferPriceTierRange[],
): void {
  if (!tiers.length) return;

  for (const tier of tiers) {
    if (!(tier.minQty > 0)) {
      throw new Error('INVALID_BULK_PRICE_RANGE: minQuantity must be > 0');
    }
    if (!(tier.price > 0)) {
      throw new Error('INVALID_BULK_PRICE_RANGE: price must be > 0');
    }
    if (tier.maxQty != null && tier.maxQty < tier.minQty) {
      throw new Error(
        'INVALID_BULK_PRICE_RANGE: maxQuantity must be >= minQuantity',
      );
    }
  }

  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    const prevMax = prev.maxQty == null ? Number.POSITIVE_INFINITY : prev.maxQty;
    if (curr.minQty <= prevMax) {
      throw new Error(
        'INVALID_BULK_PRICE_RANGE: quantity ranges must not overlap',
      );
    }
  }
}

/**
 * Server-authoritative validity window from hours.
 */
export function resolveOfferValidityWindow(input: {
  validityHours?: number | null;
  validFrom?: string | Date | null;
  validUntil?: string | Date | null;
  now?: Date;
}): { validFrom?: Date; validUntil?: Date } {
  const now = input.now ?? new Date();
  if (input.validityHours != null && input.validityHours > 0) {
    const validFrom = now;
    const validUntil = new Date(
      now.getTime() + input.validityHours * 60 * 60 * 1000,
    );
    return { validFrom, validUntil };
  }

  return {
    validFrom: input.validFrom ? new Date(input.validFrom) : undefined,
    validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
  };
}
