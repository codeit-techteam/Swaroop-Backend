/**
 * Safe, idempotent data correction for B-06:
 * Same seller org with multiple ACTIVE marketplace products on the same grade
 * (and typically the same warehouse) creates indistinguishable Market cards.
 *
 * Keeps the listing with the most stock (fallback: newest updatedAt) and soft-
 * deactivates the extras. Does NOT merge legitimate cross-seller competition
 * with different prices / MOQs / origins.
 *
 * Usage:
 *   npx tsx scripts/fix-duplicate-marketplace-listings.ts --dry-run
 *   npx tsx scripts/fix-duplicate-marketplace-listings.ts --apply
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, ProductStatus } from '../src/generated/prisma/client.js';

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
  const duplicates = await prisma.$queryRaw<
    Array<{
      organization_id: string;
      grade_id: string;
      product_count: bigint;
    }>
  >`
    SELECT p.organization_id, p.grade_id, COUNT(*)::bigint AS product_count
    FROM products p
    WHERE p.deleted_at IS NULL
      AND p.status = ${ProductStatus.ACTIVE}::"ProductStatus"
    GROUP BY p.organization_id, p.grade_id
    HAVING COUNT(*) > 1
    ORDER BY product_count DESC
  `;

  console.log(
    `Found ${duplicates.length} org+grade group(s) with multiple ACTIVE products`,
  );

  let deactivated = 0;
  for (const row of duplicates) {
    const products = await prisma.product.findMany({
      where: {
        organizationId: row.organization_id,
        gradeId: row.grade_id,
        deletedAt: null,
        status: ProductStatus.ACTIVE,
      },
      select: {
        id: true,
        code: true,
        name: true,
        updatedAt: true,
        inventory: {
          where: { deletedAt: null },
          select: { availableQty: true },
        },
        offers: {
          where: { deletedAt: null, status: 'ACTIVE' },
          select: { id: true, basePrice: true, moq: true },
          take: 1,
        },
        grade: { select: { code: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const ranked = [...products].sort((a, b) => {
      const stockA = a.inventory.reduce(
        (sum, row) => sum + Number(row.availableQty ?? 0),
        0,
      );
      const stockB = b.inventory.reduce(
        (sum, row) => sum + Number(row.availableQty ?? 0),
        0,
      );
      if (stockB !== stockA) return stockB - stockA;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    const [keeper, ...extras] = ranked;
    if (!keeper || extras.length === 0) continue;

    console.log(
      ` grade ${keeper.grade?.code ?? row.grade_id}: keep ${keeper.code} (${keeper.id}), deactivate ${extras.length}`,
    );
    for (const extra of extras) {
      console.log(`  - ${extra.code} (${extra.id})`);
      if (APPLY) {
        await prisma.product.update({
          where: { id: extra.id },
          data: { status: ProductStatus.PAUSED },
        });
        deactivated += 1;
      }
    }
  }

  console.log(
    APPLY
      ? `Applied. Deactivated ${deactivated} duplicate listing(s).`
      : 'Dry run only. Re-run with --apply to persist.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
