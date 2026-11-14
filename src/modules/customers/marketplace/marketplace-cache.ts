import { TtlCache } from '../../locations/ttl-cache.js';

/**
 * Short-lived in-memory cache for anonymous marketplace reads.
 * Invalidated via bumpMarketplaceCache() after catalogue mutations.
 */
let generation = 1;

export function bumpMarketplaceCache() {
  generation += 1;
}

export function marketplaceCacheKey(parts: string[]): string {
  return `g${generation}:${parts.join('|')}`;
}

/** Categories + home summary: 30s TTL, small footprint. */
export const marketplaceReadCache = new TtlCache<unknown>(30_000, 64);
