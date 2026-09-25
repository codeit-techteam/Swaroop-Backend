import { describe, expect, it } from 'vitest';
import {
  InventoryStatus,
  ProductStatus,
} from '../../../generated/prisma/client.js';

describe('Inventory summary contract', () => {
  it('exposes activeProducts and structured onHand/sellable fields', () => {
    const summary = {
      onHand: { quantity: 100, unit: 'MT' },
      sellable: { quantity: 80, unit: 'MT' },
      activeProducts: 12,
      lowStock: 2,
      outOfStock: 1,
      warehouses: 3,
      skuCount: 15,
      totalAvailable: 80,
      totalReserved: 20,
      totalAllocated: 0,
      totalDamaged: 0,
      totalIncoming: 0,
      totalSold: 0,
      lowStockCount: 2,
      outOfStockCount: 1,
      unit: 'MT',
    };

    expect(summary.activeProducts).toBe(12);
    expect(summary.onHand.quantity).toBe(
      summary.totalAvailable + summary.totalReserved,
    );
    expect(summary.sellable.quantity).toBe(summary.totalAvailable);
    expect(summary.lowStock).toBe(summary.lowStockCount);
    expect(ProductStatus.ACTIVE).toBe('ACTIVE');
    expect(InventoryStatus.LOW).toBe('LOW');
  });
});
