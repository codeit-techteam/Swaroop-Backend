import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import type { PrismaService } from '../../../database/prisma.service.js';
import type { AdminAuditService } from '../../admin/common/admin-audit.service.js';
import { GradeQueryDto } from './grades.dto.js';
import { GradesService } from './grades.service.js';

const before = {
  id: 'g1',
  source: 'SOURCE_ONE',
  code: 'SO-PP-H110MA-RELIANCE-ABC123',
  name: 'H110MA',
  displayName: 'PP Raffia H110MA - Reliance',
  description: null,
  categoryId: 'cat-pp',
  subcategoryId: 'sub-raffia',
  status: 'ACTIVE',
  customerVisible: true,
  sellerVisible: true,
  sortOrder: 0,
  hsnCode: null,
};

const stored = {
  ...before,
  category: {
    id: 'cat-pp',
    code: 'PP',
    name: 'PP',
    displayName: 'PP',
    parentGroup: 'POLYMERS',
  },
  subcategory: null,
  gradeApplications: [],
  applications: [],
  gradeGroup: 'PP Raffia',
  gradeNo: 'H110MA',
  manufacturer: 'Reliance',
  fullGradeName: null,
  inTodaysDelhiPriceList: true,
  priceTodayRsKg: { toFixed: () => '104.25' },
  producerPriceRsKg: null,
  producerPriceType: null,
  sourceReference: 'file.csv#L4',
  version: 1,
  lastImportedAt: null,
  importBatchId: null,
  metadata: null,
};

function setup() {
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    ...stored,
    ...Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    ),
  }));
  const prisma = {
    grade: {
      findFirst: vi.fn(async (args: { select?: Record<string, true> }) =>
        args.select
          ? Object.fromEntries(
              Object.keys(args.select).map((k) => [
                k,
                stored[k as keyof typeof stored],
              ]),
            )
          : { ...stored },
      ),
      update,
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const service = new GradesService(
    prisma as unknown as PrismaService,
    audit as unknown as AdminAuditService,
  );
  return { service, prisma, audit };
}

describe('GradesService admin changes', () => {
  it('logs GRADE_DEACTIVATED with the previous and new status', async () => {
    const { service, audit } = setup();
    await service.updateStatus(
      'g1',
      { status: 'INACTIVE' } as never,
      'admin-1',
    );

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'GRADE_DEACTIVATED',
        actorUserId: 'admin-1',
        entityId: 'g1',
        previousData: { status: 'ACTIVE' },
        newData: { status: 'INACTIVE' },
      }),
    );
  });

  it('logs only the visibility flags that actually changed', async () => {
    const { service, audit } = setup();
    await service.updateVisibility(
      'g1',
      { customerVisible: false, sellerVisible: true },
      'admin-1',
    );

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CUSTOMER_VISIBILITY_CHANGED',
        previousData: { customerVisible: true },
        newData: { customerVisible: false },
      }),
    );
  });

  it('does not write an audit entry when the status is unchanged', async () => {
    const { service, audit } = setup();
    await service.updateStatus('g1', { status: 'ACTIVE' } as never, 'admin-1');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects manual edits to import-managed fields of Source.One grades', async () => {
    const { service, prisma } = setup();
    await expect(
      service.update('g1', { categoryId: 'cat-hdpe' } as never, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.grade.update).not.toHaveBeenCalled();
  });

  it('allows editing permitted metadata and audits the change', async () => {
    const { service, audit } = setup();
    await service.update(
      'g1',
      { displayName: 'Repol H110MA', hsnCode: '3902' } as never,
      'admin-1',
    );

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'GRADE_UPDATED',
        previousData: {
          displayName: 'PP Raffia H110MA - Reliance',
          hsnCode: null,
        },
        newData: { displayName: 'Repol H110MA', hsnCode: '3902' },
      }),
    );
  });

  it('exposes prices to admin responses only', async () => {
    const { service } = setup();
    const admin = await service.findOne('g1');
    const consumer = await service.findOne('g1', true);

    expect(admin).toMatchObject({
      priceTodayRsKg: '104.25',
      manufacturer: 'Reliance',
    });
    expect(consumer).toMatchObject({
      manufacturer: 'Reliance',
      gradeNo: 'H110MA',
    });
    expect(consumer).not.toHaveProperty('priceTodayRsKg');
  });

  it('scopes customer/seller grade detail to grades visible on their side', async () => {
    const { service, prisma } = setup();
    const grade = await service.findVisible('g1', ['customer', 'seller']);

    expect(prisma.grade.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: 'g1',
          OR: [
            { deletedAt: null, status: 'ACTIVE', customerVisible: true },
            { deletedAt: null, status: 'ACTIVE', sellerVisible: true },
          ],
        },
      }),
    );
    expect(grade).not.toHaveProperty('priceTodayRsKg');
  });

  it('treats hidden or inactive grades as not found for customers and sellers', async () => {
    const { service, prisma } = setup();
    prisma.grade.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.findVisible('g1', ['customer'])).rejects.toThrow(
      'Grade not found',
    );
    await expect(service.findVisible('g1', [])).rejects.toThrow(
      'Grade not found',
    );
  });
});

describe('GradeQueryDto', () => {
  it('parses query-string booleans instead of treating "false" as true', () => {
    const dto = plainToInstance(GradeQueryDto, {
      customerVisible: 'false',
      sellerVisible: 'true',
      inTodaysDelhiPriceList: 'false',
    });
    expect(dto.customerVisible).toBe(false);
    expect(dto.sellerVisible).toBe(true);
    expect(dto.inTodaysDelhiPriceList).toBe(false);
  });
});
