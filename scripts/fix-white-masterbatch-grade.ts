/**
 * Safe, idempotent data correction for B-05 / N-03:
 * White Masterbatch TiO2 products incorrectly tagged via MASTERBATCH_BLACK.
 *
 * Product.gradeId is required, so this does NOT invent MASTERBATCH_WHITE and
 * does NOT null the grade FK. It corrects technicalSpecs so customer cards
 * show "White Masterbatch" / product name instead of the raw MASTERBATCH_BLACK code.
 *
 * Usage (against a reachable DATABASE_URL — never run blindly on prod):
 *   npx tsx scripts/fix-white-masterbatch-grade.ts --dry-run
 *   npx tsx scripts/fix-white-masterbatch-grade.ts --apply
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const APPLY = process.argv.includes('--apply');

function createPrisma() {
  const adapter = new PrismaPg({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5433/swaroop?schema=public',
  });
  return new PrismaClient({ adapter });
}

async function main() {
  const prisma = createPrisma();
  try {
    await run(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function run(prisma: PrismaClient) {
  const black = await prisma.grade.findFirst({
    where: {
      OR: [{ code: 'MASTERBATCH_BLACK' }, { name: 'MASTERBATCH_BLACK' }],
      deletedAt: null,
    },
    select: { id: true, code: true, displayName: true },
  });

  if (!black) {
    console.log('No MASTERBATCH_BLACK grade found — nothing to fix.');
    return;
  }

  const candidates = await prisma.product.findMany({
    where: {
      deletedAt: null,
      OR: [
        { gradeId: black.id },
        {
          technicalSpecs: {
            path: ['materialType'],
            string_contains: 'MASTERBATCH_BLACK',
          },
        },
      ],
      AND: [
        {
          OR: [
            { name: { contains: 'White', mode: 'insensitive' } },
            { name: { contains: 'TiO2', mode: 'insensitive' } },
            { name: { contains: 'TIO2', mode: 'insensitive' } },
            { description: { contains: 'titanium dioxide', mode: 'insensitive' } },
            { description: { contains: 'white masterbatch', mode: 'insensitive' } },
            { code: { contains: 'MB-WH', mode: 'insensitive' } },
          ],
        },
      ],
    },
    select: {
      id: true,
      name: true,
      code: true,
      gradeId: true,
      technicalSpecs: true,
    },
  });

  console.log(
    `Found ${candidates.length} white/TiO2 product(s) to correct (grade ${black.code})`,
  );

  for (const product of candidates) {
    const specs =
      product.technicalSpecs && typeof product.technicalSpecs === 'object'
        ? { ...(product.technicalSpecs as Record<string, unknown>) }
        : {};

    let changed = false;
    if (
      typeof specs.materialType === 'string' &&
      (/MASTERBATCH_BLACK/i.test(specs.materialType) || !specs.materialType.trim())
    ) {
      specs.materialType = 'Masterbatch';
      changed = true;
    } else if (!specs.materialType) {
      specs.materialType = 'Masterbatch';
      changed = true;
    }
    if (
      !specs.subCategory ||
      (typeof specs.subCategory === 'string' &&
        /MASTERBATCH_BLACK|black/i.test(specs.subCategory))
    ) {
      specs.subCategory = 'White';
      changed = true;
    }
    if (!specs.parentCategoryId) {
      specs.parentCategoryId = 'additives';
      changed = true;
    }

    console.log(
      ` - ${product.id} | ${product.name} | ${product.code}${changed ? ' → specs fixed' : ' (specs already ok)'}`,
    );
    if (APPLY && changed) {
      await prisma.product.update({
        where: { id: product.id },
        data: { technicalSpecs: specs },
      });
    }
  }

  console.log(APPLY ? 'Applied.' : 'Dry run only. Re-run with --apply to persist.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
