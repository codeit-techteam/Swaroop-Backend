/**
 * Reports catalog / listing records that need Admin review.
 * Does NOT delete or merge anything — safe for production read-only audits.
 *
 * Usage: npx tsx scripts/report-catalog-review.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, ProductStatus } from '../src/generated/prisma/client.js';

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
    const legacyTio2 = await prisma.grade.findMany({
      where: { code: 'TIO2', deletedAt: null },
      select: {
        id: true,
        code: true,
        customerVisible: true,
        sellerVisible: true,
        category: { select: { code: true } },
      },
    });

    const tio2Category = await prisma.gradeCategory.findFirst({
      where: { code: 'TIO2', deletedAt: null },
      select: { id: true, code: true, _count: { select: { grades: true } } },
    });

    const mbBlackLinked = await prisma.product.findMany({
      where: {
        deletedAt: null,
        grade: { code: 'MASTERBATCH_BLACK' },
        OR: [
          { name: { contains: 'White', mode: 'insensitive' } },
          { name: { contains: 'TiO2', mode: 'insensitive' } },
          { name: { contains: 'UV', mode: 'insensitive' } },
          { code: { in: ['MB-WH-50', 'MB-UV-20'] } },
        ],
      },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        organizationId: true,
        grade: { select: { code: true } },
      },
    });

    const duplicateActiveByGrade = await prisma.$queryRaw<
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
      LIMIT 50
    `;

    const report = {
      generatedAt: new Date().toISOString(),
      legacyCoarseTio2Grade: legacyTio2,
      sourceOneTio2Category: tio2Category,
      suspiciousMasterbatchBlackMappings: mbBlackLinked,
      duplicateActiveListingsByOrgGrade: duplicateActiveByGrade.map((row) => ({
        organizationId: row.organization_id,
        gradeId: row.grade_id,
        productCount: Number(row.product_count),
      })),
      guidance: [
        'Do not invent grade mappings for white/UV masterbatch — Admin must add authoritative grades first.',
        'Legacy seed grade TIO2 should remain customerVisible=false when Source.One TIO2 category grades exist.',
        'Duplicate ACTIVE products sharing org+grade should be reviewed; prefer updating the existing listing.',
      ],
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
