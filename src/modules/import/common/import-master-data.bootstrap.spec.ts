import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaService } from '../../../database/prisma.service.js';
import { insertMissingImportMasterData } from './import-master-data.bootstrap.js';

type MasterData = Parameters<typeof insertMissingImportMasterData>[1];

const data = JSON.parse(
  readFileSync(
    join(process.cwd(), 'prisma/seed-data/import-master-data.json'),
    'utf8',
  ),
) as MasterData;

function fakePrisma() {
  const createMany = () =>
    vi.fn(({ data: rows }: { data: unknown[] }) =>
      Promise.resolve({ count: rows.length }),
    );
  return {
    currency: { createMany: createMany() },
    incoterm: { createMany: createMany() },
    location: {
      createMany: createMany(),
      findMany: vi.fn(() =>
        Promise.resolve(
          data.countries.map((c) => ({ id: `loc-${c.code}`, code: c.code })),
        ),
      ),
    },
    port: { createMany: createMany() },
    brand: { createMany: createMany() },
    packaging: { createMany: createMany() },
    documentRequirement: { createMany: createMany() },
    paymentTerm: { createMany: createMany() },
  };
}

describe('insertMissingImportMasterData', () => {
  it('inserts every reference table with skipDuplicates so existing rows are untouched', async () => {
    const prisma = fakePrisma();
    const inserted = await insertMissingImportMasterData(
      prisma as unknown as PrismaService,
      data,
    );

    expect(inserted.currencies).toBe(data.currencies.length);
    expect(inserted.ports).toBe(data.ports.length);
    expect(inserted.paymentTerms).toBe(data.paymentTerms.length);
    for (const table of [
      prisma.currency,
      prisma.incoterm,
      prisma.location,
      prisma.port,
      prisma.brand,
      prisma.packaging,
      prisma.documentRequirement,
      prisma.paymentTerm,
    ]) {
      expect(table.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
    }
  });

  it('links ports to their country and enables USD for Import', async () => {
    const prisma = fakePrisma();
    await insertMissingImportMasterData(
      prisma as unknown as PrismaService,
      data,
    );

    const ports = prisma.port.createMany.mock.calls[0][0].data as Array<{
      countryCode: string;
      countryId?: string;
    }>;
    expect(ports.every((p) => p.countryId === `loc-${p.countryCode}`)).toBe(
      true,
    );

    const currencies = prisma.currency.createMany.mock.calls[0][0]
      .data as Array<{ code: string; importEnabled: boolean }>;
    expect(currencies).toContainEqual(
      expect.objectContaining({ code: 'USD', importEnabled: true }),
    );
  });
});
