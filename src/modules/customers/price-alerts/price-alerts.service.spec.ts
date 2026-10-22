import { NotFoundException } from '@nestjs/common';
import { CurrencyCode, Prisma } from '../../../generated/prisma/client.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../database/prisma.service.js';
import type { CustomerContextService } from '../common/customer-context.service.js';
import { PriceAlertsService } from './price-alerts.service.js';

const customer = {
  userId: 'user-1',
  customerProfileId: 'cust-profile-1',
  organizationId: 'org-1',
};

const alertRow = {
  id: 'alert-1',
  gradeId: 'grade-1',
  productId: null as string | null,
  targetPrice: new Prisma.Decimal('140000'),
  currency: CurrencyCode.INR,
  unit: 'MT',
  direction: 'BELOW',
  enabled: true,
  lastTriggeredAt: null,
  lastTriggeredPrice: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  grade: {
    id: 'grade-1',
    code: 'G1',
    name: 'F46003',
    displayName: 'HDPE F46003',
  },
  product: null,
};

function setup() {
  const prisma = {
    priceAlert: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [alertRow]),
      findFirst: vi.fn(async () => alertRow),
      create: vi.fn(async () => alertRow),
      update: vi.fn(async () => ({ ...alertRow, enabled: false })),
    },
    grade: {
      findFirst: vi.fn(async () => ({ id: 'grade-1' })),
    },
    product: {
      findFirst: vi.fn(async () => null),
    },
  };
  const customerContext = {
    getOrCreateCustomer: vi.fn(async () => customer),
  };
  const service = new PriceAlertsService(
    prisma as unknown as PrismaService,
    customerContext as unknown as CustomerContextService,
  );
  return { service, prisma, customerContext };
}

describe('PriceAlertsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scopes list queries by customerProfileId and marks evaluation unsupported', async () => {
    const { service, prisma, customerContext } = setup();
    const result = await service.list('user-1', { page: 1, limit: 20 });

    expect(customerContext.getOrCreateCustomer).toHaveBeenCalledWith('user-1');
    const [countArgs] = prisma.priceAlert.count.mock.calls[0] as unknown as [
      { where: Record<string, unknown> },
    ];
    expect(countArgs.where).toMatchObject({
      customerProfileId: 'cust-profile-1',
      deletedAt: null,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].evaluation).toEqual({
      supported: false,
      reason: expect.stringMatching(/will not fire/i),
    });
  });

  it('soft-deletes an owned alert', async () => {
    const { service, prisma } = setup();
    const result = await service.remove('user-1', 'alert-1');

    expect(prisma.priceAlert.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'alert-1',
        customerProfileId: 'cust-profile-1',
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(prisma.priceAlert.update).toHaveBeenCalledWith({
      where: { id: 'alert-1' },
      data: { deletedAt: expect.any(Date), enabled: false },
    });
    expect(result).toEqual({ id: 'alert-1', deleted: true });
  });

  it('returns not found for another customer / missing alert', async () => {
    const { service, prisma } = setup();
    prisma.priceAlert.findFirst.mockResolvedValueOnce(null);

    await expect(service.remove('user-1', 'alert-other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.priceAlert.update).not.toHaveBeenCalled();
  });

  it('update ownership check uses customerProfileId', async () => {
    const { service, prisma } = setup();
    prisma.priceAlert.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.update('user-1', 'alert-x', { enabled: false }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.priceAlert.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'alert-x',
        customerProfileId: 'cust-profile-1',
        deletedAt: null,
      },
    });
  });
});
