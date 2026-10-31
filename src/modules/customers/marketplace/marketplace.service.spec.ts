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
    // search is tokenised: AND[ OR(fields...) ] and covers every identity column
    expect(JSON.stringify(args.where.AND)).toEqual(
      expect.stringContaining('"gradeNo":{"contains":"HF0963"'),
    );
    for (const field of [
      'manufacturer',
      'gradeGroup',
      'fullGradeName',
      'code',
    ]) {
      expect(JSON.stringify(args.where.AND)).toContain(`"${field}":`);
    }
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

  it('does not require live offers for default catalogue search', async () => {
    const { service, prisma } = setup();
    await service.listGrades('u1', { search: '4811' });

    const [args] = prisma.grade.findMany.mock.calls[0] as unknown as [
      { where: Record<string, unknown> },
    ];
    expect(args.where).not.toHaveProperty('offers');
    expect(JSON.stringify(args.where.AND)).toContain(
      '"gradeNo":{"contains":"4811","mode":"insensitive"}',
    );
  });

  it('ranks matches best-first, paginates the ranked list and echoes the query', async () => {
    const mk = (id: string, over: Record<string, unknown>) => ({
      ...grade,
      id,
      ...over,
    });
    const candidates = [
      mk('desc', {
        code: 'Z3',
        name: 'Z3',
        gradeNo: null,
        manufacturer: null,
        gradeGroup: null,
        fullGradeName: null,
        displayName: 'Z3',
        description: 'like F4811',
        category: null,
        gradeApplications: [],
      }),
      mk('exact', {
        code: 'F4811',
        name: 'F4811',
        gradeNo: 'F4811',
        displayName: 'F4811',
        fullGradeName: 'F4811',
        category: null,
        gradeApplications: [],
      }),
      mk('prefix', {
        code: 'F4811X',
        name: 'F4811X',
        gradeNo: 'F4811X',
        displayName: 'F4811X',
        fullGradeName: 'F4811X',
        category: null,
        gradeApplications: [],
      }),
    ];
    const { service, prisma } = setup();
    prisma.grade.findMany
      .mockResolvedValueOnce(candidates as never) // candidate query
      .mockImplementationOnce((async (a: { where: { id: { in: string[] } } }) =>
        candidates.filter((c) => a.where.id.in.includes(c.id))) as never);
    prisma.grade.count.mockResolvedValue(3);
    prisma.offer.groupBy.mockResolvedValue([]);

    const page1 = await service.listGrades('u1', {
      search: ' F4811 ',
      page: 1,
      limit: 2,
    } as never);
    expect(page1.items.map((i) => i.id)).toEqual(['exact', 'prefix']);
    expect(page1.meta).toMatchObject({ total: 3, page: 1, query: 'F4811' });

    prisma.grade.findMany
      .mockResolvedValueOnce(candidates as never)
      .mockImplementationOnce((async (a: { where: { id: { in: string[] } } }) =>
        candidates.filter((c) => a.where.id.in.includes(c.id))) as never);
    const page2 = await service.listGrades('u1', {
      search: 'F4811',
      page: 2,
      limit: 2,
    } as never);
    expect(page2.items.map((i) => i.id)).toEqual(['desc']);
  });

  it('keeps catalogue grades with no live offers discoverable ("No live offers")', async () => {
    const { service, prisma } = setup();
    prisma.offer.groupBy.mockResolvedValue([]);
    const { items } = await service.listGrades('u1', {
      search: 'F46003',
    } as never);
    expect(items[0]).toMatchObject({ liveOfferCount: 0, hasLiveOffers: false });
  });

  it('never hydrates unpublished/hidden grades (visibility filter re-applied)', async () => {
    const { service, prisma } = setup();
    await service.listGrades('u1', { search: 'F46003' } as never);
    const calls = prisma.grade.findMany.mock.calls as unknown as [
      { where: Record<string, unknown> },
    ][];
    for (const [args] of calls) {
      expect(args.where).toMatchObject({
        deletedAt: null,
        status: 'ACTIVE',
        customerVisible: true,
      });
    }
  });
});
