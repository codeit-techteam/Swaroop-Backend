import { describe, expect, it } from 'vitest';
import {
  EXCLUDED_TEST_PRODUCT_IDS,
  excludedTestProductWhere,
  isExcludedTestProduct,
} from './excluded-test-products.js';
import { buyableMarketplaceProductWhere } from './marketplace.service.js';

describe('excluded test products', () => {
  it('recognises confirmed client test SKUs by id and code+name', () => {
    expect(
      isExcludedTestProduct({
        id: '97625de6-82b0-4b3a-97f3-f2410b500011',
      }),
    ).toBe(true);
    expect(
      isExcludedTestProduct({
        code: 'HDPE_BLOW',
        name: 'HD Blow Test',
      }),
    ).toBe(true);
    expect(
      isExcludedTestProduct({
        code: 'HDPE_BLOW',
        name: 'HD Blow',
      }),
    ).toBe(false);
  });

  it('exports both confirmed product ids', () => {
    expect(EXCLUDED_TEST_PRODUCT_IDS).toEqual([
      '97625de6-82b0-4b3a-97f3-f2410b500011',
      '6facf910-95c3-4d83-abd9-48ad7f78ebea',
    ]);
  });

  it('buyableMarketplaceProductWhere excludes confirmed test products', () => {
    const where = buyableMarketplaceProductWhere(
      new Date('2026-11-14T00:00:00.000Z'),
    );
    expect(where).toMatchObject(excludedTestProductWhere());
    expect(where).toMatchObject({
      deletedAt: null,
      status: 'ACTIVE',
    });
  });
});
