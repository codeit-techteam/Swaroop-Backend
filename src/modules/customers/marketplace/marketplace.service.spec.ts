import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import type { PrismaService } from '../../../database/prisma.service.js';
import type { CustomerContextService } from '../common/customer-context.service.js';
import { MarketplaceGradeQueryDto } from './marketplace.dto.js';
import { MarketplaceService } from './marketplace.service.js';

const grade = {
  id: 'g1',
  code: 'SO-HDPE-F46003-RIL-ABC123',
  name: 'F46003',
  displayName: 'HDPE FILM F46003 - RIL',
  description: null,
  categoryId: 'cat-hdpe',
  sortOrder: 0,
  status: 'ACTIVE',
  gradeGroup: 'HD FILM',
  gradeNo: 'F46003',
  manufacturer: 'RIL',
  fullGradeName: 'HDPE FILM F46003 - RIL',
  inTodaysDelhiPriceList: true,
  category: {
    id: 'cat-hdpe',
    code: 'HDPE',
    name: 'HDPE',
    displayName: null,
    parentGroup: 'POLYMERS',
  },
};

function setup() {
  const prisma = {
    grade: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [grade]),
      findFirst: vi.fn(async () => grade as typeof grade | null),
    },
    offer: {
      groupBy: vi.fn(async () => [{ gradeId: 'g1', _count: { _all: 3 } }]),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const context = { getOrCreateCustomer: vi.fn(async () => ({})) };
  const service = new MarketplaceService(
    prisma as unknown as PrismaService,
    context as unknown as CustomerContextService,
  );
  return { service, prisma };
}

describe('MarketplaceService grade browsing', () => {
  it('filters on the server and searches every Source.One identity column', async () => {
    const { service, prisma } = setup();
    await service.listGrades('u1', {
      search: 'HF0963',
      category: 'hdpe',
      gradeGroup: 'HD FILM',
      manufacturer: 'ril',
      hasOffers: true,
    });

    const [args] = prisma.grade.findMany.mock.calls[0] as unknown as [
      { where: Record<string, unknown> },
    ];
    expect(args.where).toMatchObject({
      deletedAt: null,
      status: 'ACTIVE',
      customerVisible: true,
      category: { code: 'HDPE' },
      gradeGroup: { equals: 'HD FILM', mode: 'insensitive' },
      manufacturer: { equals: 'ril', mode: 'insensitive' },
      offers: { some: expect.any(Object) },
    });
    const searched = (args.where.OR as Record<string, unknown>[]).flatMap(
      (clause) => Object.keys(clause),
    );
    expect(searched).toEqual(
      expect.arrayContaining([
        'gradeNo',
        'manufacturer',
        'gradeGroup',
        'fullGradeName',
      ]),
    );
  });

  it('returns live offer counts without reference prices or seller identity', async () => {
    const { service, prisma } = setup();
    const { items, meta } = await service.listGrades('u1', {});

    expect(prisma.offer.groupBy).toHaveBeenCalledTimes(1);
    expect(meta).toMatchObject({ total: 1, page: 1 });
    expect(items[0]).toMatchObject({
      id: 'g1',
      gradeNo: 'F46003',
      manufacturer: 'RIL',
      liveOfferCount: 3,
      category: { code: 'HDPE', displayName: 'HDPE' },
    });
    for (const key of [
      'priceTodayRsKg',
      'producerPriceRsKg',
      'producerPriceType',
      'sellerId',
      'organizationId',
    ]) {
      expect(items[0]).not.toHaveProperty(key);
    }
  });

  it('hides grades that are inactive or not customer-visible', async () => {
    const { service, prisma } = setup();
    prisma.grade.findFirst.mockResolvedValueOnce(null);
    await expect(service.getGrade('u1', 'g1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.grade.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'g1',
          deletedAt: null,
          status: 'ACTIVE',
          customerVisible: true,
        },
      }),
    );
  });

  it('parses hasOffers from the query string', () => {
    expect(
      plainToInstance(MarketplaceGradeQueryDto, { hasOffers: 'false' })
        .hasOffers,
    ).toBe(false);
    expect(
      plainToInstance(MarketplaceGradeQueryDto, { hasOffers: 'true' })
        .hasOffers,
    ).toBe(true);
  });
});
