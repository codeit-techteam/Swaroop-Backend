import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { SOURCE_ONE_HEADERS, SourceOneCsvError } from './source-one-csv.js';
import { importSourceOneGrades } from './source-one-importer.js';

type Row = Record<string, unknown> & { id: string };

const HEADER = SOURCE_ONE_HEADERS.join(',');
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

const FILE = csv(
  'HDPE,HD Film,F46003,Reliance,Relene F46003,Yes,112.50,110.00,Ex-Depot',
  'HDPE,HD Film,F46003,Reliance,,No,,,',
  'PP,PP Raffia,H110MA,Reliance,,No,,,',
  'Barex,Barex Resin,210,INEOS,,No,,,',
);

/** In-memory stand-in for the Prisma calls the importer makes. */
function fakePrisma(options: { failOnGradeCreate?: boolean } = {}) {
  const db = {
    gradeCategory: [
      { id: 'cat-hdpe', code: 'HDPE', name: 'HDPE', parentGroup: 'POLYMERS' },
    ] as Row[],
    subcategory: [] as Row[],
    grade: [] as Row[],
    gradeImportBatch: [] as Row[],
    auditLog: [] as Row[],
  };

  const matches = (row: Row, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([key, cond]) => {
      if (cond && typeof cond === 'object' && 'in' in cond) {
        return (cond as { in: unknown[] }).in.includes(row[key]);
      }
      return row[key] === cond;
    });

  const table = (rows: Row[], extra: Record<string, unknown> = {}) => ({
    findMany: vi.fn(
      async ({ where }: { where?: Record<string, unknown> } = {}) =>
        rows.filter((r) => matches(r, where)).map((r) => ({ ...r })),
    ),
    createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
      for (const d of data) rows.push({ id: randomUUID(), ...d });
      return { count: data.length };
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: randomUUID(), status: 'RUNNING', ...data };
      rows.push(row);
      return { ...row };
    }),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = rows.find((r) => r.id === where.id)!;
        for (const [key, value] of Object.entries(data)) {
          row[key] =
            value && typeof value === 'object' && 'increment' in value
              ? (row[key] as number) +
                (value as { increment: number }).increment
              : value;
        }
        return { ...row };
      },
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const hit = rows.filter((r) => matches(r, where));
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      },
    ),
    ...extra,
  });

  const client = {
    gradeCategory: table(db.gradeCategory),
    subcategory: table(db.subcategory),
    grade: table(db.grade),
    gradeImportBatch: table(db.gradeImportBatch),
    auditLog: table(db.auditLog),
    $executeRaw: vi.fn(async () => 0),
  };
  if (options.failOnGradeCreate) {
    client.grade.createMany = vi.fn(async () => {
      throw new Error('connection lost');
    });
  }

  const prisma = {
    ...client,
    $transaction: vi.fn(async (fn: (tx: typeof client) => Promise<unknown>) => {
      const snapshot = structuredClone(db);
      try {
        return await fn(client);
      } catch (error) {
        for (const key of Object.keys(db) as Array<keyof typeof db>) {
          db[key].splice(0, db[key].length, ...snapshot[key]);
        }
        throw error;
      }
    }),
  };
  return { db, prisma: prisma as unknown as PrismaClient, client };
}

const run = (prisma: PrismaClient, csvText = FILE, dryRun = false) =>
  importSourceOneGrades(prisma, {
    csv: csvText,
    fileName: 'SourcePlus_ALL_Unique_Grades_Master.csv',
    trigger: 'CLI',
    dryRun,
  });

describe('importSourceOneGrades', () => {
  it('inserts new grades ACTIVE and visible, reusing existing categories', async () => {
    const { db, prisma } = fakePrisma();
    const summary = await run(prisma);

    expect(summary).toMatchObject({
      totalRows: 4,
      validRows: 4,
      duplicateRows: 1,
      grades: 3,
      inserted: 3,
      updated: 0,
      unchanged: 0,
      categoriesCreated: 2,
      gradeGroupsCreated: 3,
    });
    expect(db.gradeCategory.map((c) => c.code).sort()).toEqual([
      'BAREX',
      'HDPE',
      'PP',
    ]);
    expect(db.gradeCategory.find((c) => c.code === 'HDPE')!.id).toBe(
      'cat-hdpe',
    );

    const film = db.grade.find((g) => g.gradeNo === 'F46003')!;
    expect(film).toMatchObject({
      source: 'SOURCE_ONE',
      status: 'ACTIVE',
      customerVisible: true,
      sellerVisible: true,
      categoryId: 'cat-hdpe',
      priceTodayRsKg: '112.50',
      displayName: 'Relene F46003',
      version: 1,
    });
    expect(db.gradeImportBatch[0]).toMatchObject({
      status: 'COMPLETED',
      insertedRows: 3,
    });
    expect(db.auditLog).toEqual([
      expect.objectContaining({ action: 'GRADE_IMPORTED' }),
    ]);
  });

  it('is idempotent: a second import of the same file changes nothing', async () => {
    const { db, prisma } = fakePrisma();
    await run(prisma);
    const summary = await run(prisma);

    expect(summary).toMatchObject({ inserted: 0, updated: 0, unchanged: 3 });
    expect(db.grade).toHaveLength(3);
    expect(db.grade.every((g) => g.version === 1)).toBe(true);
  });

  it('refreshes Source.One columns but never Admin status, visibility or edited names', async () => {
    const { db, prisma } = fakePrisma();
    await run(prisma);
    const film = db.grade.find((g) => g.gradeNo === 'F46003')!;
    const raffia = db.grade.find((g) => g.gradeNo === 'H110MA')!;
    Object.assign(film, {
      status: 'INACTIVE',
      customerVisible: false,
      displayName: 'Admin label',
    });
    Object.assign(raffia, { sellerVisible: false });

    const summary = await run(
      prisma,
      csv(
        'HDPE,HD Film,F46003,Reliance,Relene F46003,Yes,118.00,110.00,Ex-Depot',
        'PP,PP Raffia,H110MA,Reliance,Repol H110MA,Yes,104.25,,',
        'Barex,Barex Resin,210,INEOS,,No,,,',
      ),
    );

    expect(summary).toMatchObject({
      inserted: 0,
      updated: 2,
      unchanged: 1,
      notInFile: 0,
    });
    expect(film).toMatchObject({
      priceTodayRsKg: '118.00',
      status: 'INACTIVE',
      customerVisible: false,
      displayName: 'Admin label',
      version: 2,
    });
    expect(raffia).toMatchObject({
      sellerVisible: false,
      displayName: 'Repol H110MA',
      fullGradeName: 'Repol H110MA',
      version: 2,
    });
    expect(db.grade.find((g) => g.gradeNo === '210')).toMatchObject({
      version: 1,
      sourceReference: 'SourcePlus_ALL_Unique_Grades_Master.csv#L4',
    });
  });

  it('reports grades missing from a newer file without deactivating them', async () => {
    const { db, prisma } = fakePrisma();
    await run(prisma);
    const summary = await run(
      prisma,
      csv('PP,PP Raffia,H110MA,Reliance,,No,,,'),
    );

    expect(summary.notInFile).toBe(2);
    expect(
      db.grade.every((g) => g.status === 'ACTIVE' && g.deletedAt === undefined),
    ).toBe(true);
  });

  it('dry run validates and diffs without writing', async () => {
    const { db, prisma } = fakePrisma();
    const summary = await run(prisma, FILE, true);

    expect(summary).toMatchObject({ batchId: null, dryRun: true, inserted: 3 });
    expect(db.grade).toHaveLength(0);
    expect(db.gradeImportBatch).toHaveLength(0);
  });

  it('rolls back every write and marks the batch FAILED when the transaction fails', async () => {
    const { db, prisma } = fakePrisma({ failOnGradeCreate: true });

    await expect(run(prisma)).rejects.toThrow('connection lost');
    expect(db.grade).toHaveLength(0);
    expect(db.gradeCategory).toHaveLength(1);
    expect(db.subcategory).toHaveLength(0);
    expect(db.gradeImportBatch[0]).toMatchObject({
      status: 'FAILED',
      errorMessage: 'connection lost',
    });
  });

  it('records a FAILED batch for a structurally invalid file', async () => {
    const { db, prisma } = fakePrisma();

    await expect(run(prisma, 'Category,Grade\nPP,1')).rejects.toBeInstanceOf(
      SourceOneCsvError,
    );
    expect(db.gradeImportBatch).toEqual([
      expect.objectContaining({ status: 'FAILED' }),
    ]);
  });
});
