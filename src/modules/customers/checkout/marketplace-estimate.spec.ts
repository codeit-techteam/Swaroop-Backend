import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentMethod, Prisma } from '../../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../database/prisma.service.js';
import { buildMarketplaceEstimate } from './marketplace-estimate.js';

function offer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offer-1',
    basePrice: new Prisma.Decimal('148000'),
    currency: 'INR',
    moq: new Prisma.Decimal('10'),
    quantity: new Prisma.Decimal('100'),
    priceTiers: [],
    metadata: null,
    ...overrides,
  };
}

function prismaWithOffer(row: ReturnType<typeof offer> | null) {
  return {
    offer: {
      findFirst: vi.fn(async () => row),
    },
  } as unknown as PrismaService;
}

describe('buildMarketplaceEstimate', () => {
  it('converts INR ₹/MT → ₹/kg (148000 → 148) and returns landed amounts', async () => {
    const prisma = prismaWithOffer(offer());
    const result = await buildMarketplaceEstimate(prisma, {
      offerId: 'offer-1',
      quantity: '25',
      paymentMethod: PaymentMethod.ADVANCE,
    });

    expect(result.currency).toBe('INR');
    expect(result.unitPricePerMt).toBe('148000.0000');
    expect(result.unitPricePerKg).toBe('148.0000');
    expect(result.binding).toBe(false);
    expect(result.amounts).toBeNull();
    expect(result.exTax).not.toBeNull();
    expect(result.inclusiveTotal).toMatch(/^\d+\.\d{2}$/);
    expect(result.note).toMatch(/Estimate only/i);
  });

  it('returns no INR conversion / null amounts for foreign currency', async () => {
    const prisma = prismaWithOffer(offer({ currency: 'USD' }));
    const result = await buildMarketplaceEstimate(prisma, {
      offerId: 'offer-1',
      quantity: '25',
    });

    expect(result.currency).toBe('USD');
    expect(result.unitPricePerMt).toBe('148000.0000');
    expect(result.unitPricePerKg).toBe('148.0000');
    expect(result.amounts).toBeNull();
    expect(result.exTax).toBeNull();
    expect(result.tax).toBeNull();
    expect(result.inclusiveTotal).toBeNull();
    expect(result.note).toMatch(/No foreign→INR conversion/i);
  });

  it('rejects quantity below MOQ via assertQuantityRules', async () => {
    const prisma = prismaWithOffer(offer({ moq: new Prisma.Decimal('25') }));
    await expect(
      buildMarketplaceEstimate(prisma, {
        offerId: 'offer-1',
        quantity: '10',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    try {
      await buildMarketplaceEstimate(prisma, {
        offerId: 'offer-1',
        quantity: '10',
      });
    } catch (err) {
      expect((err as BadRequestException).message).toBe('MOQ_NOT_MET');
    }
  });

  it('throws NotFoundException when offer is missing', async () => {
    const prisma = prismaWithOffer(null);
    await expect(
      buildMarketplaceEstimate(prisma, {
        offerId: 'missing',
        quantity: '10',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
