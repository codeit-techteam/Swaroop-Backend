/**
 * Safe, idempotent data correction for B-05 / N-03:
 * White Masterbatch TiO2 products incorrectly linked to MASTERBATCH_BLACK.
 *
 * Does NOT invent a MASTERBATCH_WHITE grade. Detaches the wrong black mapping
 * and clears enum-like materialType tags so customer cards show the product
 * name / description instead of MASTERBATCH_BLACK.
 *
 * Usage (against a reachable DATABASE_URL — never run blindly on prod):
 *   npx tsx scripts/fix-white-masterbatch-grade.ts --dry-run
 *   npx tsx scripts/fix-white-masterbatch-grade.ts --apply
 */
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
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
      gradeId: black.id,
      OR: [
        { name: { contains: 'White', mode: 'insensitive' } },
        { name: { contains: 'TiO2', mode: 'insensitive' } },
        { name: { contains: 'TIO2', mode: 'insensitive' } },
        { description: { contains: 'titanium dioxide', mode: 'insensitive' } },
        { description: { contains: 'white masterbatch', mode: 'insensitive' } },
        { sku: { contains: 'MB-WH', mode: 'insensitive' } },
        { productCode: { contains: 'MB-WH', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      name: true,
      sku: true,
      productCode: true,
      gradeId: true,
      technicalSpecs: true,
    },
  });

  console.log(
    `Found ${candidates.length} white/TiO2 product(s) wrongly on ${black.code} (${black.id})`,
  );

  for (const product of candidates) {
    const specs =
      product.technicalSpecs && typeof product.technicalSpecs === 'object'
        ? { ...(product.technicalSpecs as Record<string, unknown>) }
        : {};
    if (typeof specs.materialType === 'string' && /MASTERBATCH_BLACK/i.test(specs.materialType)) {
      specs.materialType = 'Masterbatch';
      specs.subCategory = specs.subCategory || 'White';
    }
    console.log(` - ${product.id} | ${product.name} | ${product.productCode || product.sku}`);
    if (APPLY) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          gradeId: null,
          technicalSpecs: specs,
        },
      });
    }
  }

  console.log(APPLY ? 'Applied.' : 'Dry run only. Re-run with --apply to persist.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
