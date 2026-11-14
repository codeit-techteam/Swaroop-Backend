import { describe, expect, it } from 'vitest';
import {
  bumpMarketplaceCache,
  marketplaceCacheKey,
  marketplaceReadCache,
} from './marketplace-cache.js';

describe('marketplaceReadCache', () => {
  it('returns cached values within TTL and invalidates on bump', async () => {
    const key = marketplaceCacheKey(['categories', 'guest']);
    marketplaceReadCache.set(key, { ok: 1 });
    expect(marketplaceReadCache.get(key)).toEqual({ ok: 1 });

    bumpMarketplaceCache();
    const nextKey = marketplaceCacheKey(['categories', 'guest']);
    expect(nextKey).not.toBe(key);
    expect(marketplaceReadCache.get(nextKey)).toBeUndefined();
  });
});
