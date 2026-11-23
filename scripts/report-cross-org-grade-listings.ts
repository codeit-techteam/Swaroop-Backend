/**
 * Dry-run report: Grade Master codes with ACTIVE seller Products from multiple orgs.
 * These are legitimate multi-seller marketplace listings — NOT duplicate Grade Master rows.
 * Customer Market collapses commercially identical blind cards (B-06).
 *
 * Usage:
 *   npx tsx scripts/report-cross-org-grade-listings.ts
 *   npx tsx scripts/report-cross-org-grade-listings.ts --json > /tmp/cross-org-listings.json
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, ProductStatus } from '../src/generated/prisma/client.js';

const AS_JSON = process.argv.includes('--json');
const OUT = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);

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
    const groups = await prisma.$queryRaw<
      Array<{
        grade_id: string;
        grade_code: string;
        grade_name: string;
        product_count: bigint;
        org_count: bigint;
      }>
    >`
      SELECT
        g.id AS grade_id,
        g.code AS grade_code,
        g.name AS grade_name,
        COUNT(DISTINCT p.id)::bigint AS product_count,
        COUNT(DISTINCT p.organization_id)::bigint AS org_count
      FROM products p
      JOIN grades g ON g.id = p.grade_id
      WHERE p.deleted_at IS NULL
        AND p.status = ${ProductStatus.ACTIVE}::"ProductStatus"
        AND g.deleted_at IS NULL
      GROUP BY g.id, g.code, g.name
      HAVING COUNT(DISTINCT p.organization_id) > 1
      ORDER BY product_count DESC, g.code ASC
    `;

    const details = [];
    for (const group of groups) {
      const products = await prisma.product.findMany({
        where: {
          gradeId: group.grade_id,
          deletedAt: null,
          status: ProductStatus.ACTIVE,
        },
        select: {
          id: true,
          code: true,
          name: true,
          organizationId: true,
          createdAt: true,
          organization: { select: { name: true, code: true } },
          offers: {
            where: { deletedAt: null, status: 'ACTIVE' },
            select: {
              id: true,
              basePrice: true,
              moq: true,
              quantity: true,
            },
          },
          inventory: {
            where: { deletedAt: null },
            select: { availableQty: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      details.push({
        gradeId: group.grade_id,
        gradeCode: group.grade_code,
        gradeName: group.grade_name,
        productCount: Number(group.product_count),
        orgCount: Number(group.org_count),
        recommendation:
          'Keep all rows — these are distinct seller Products on one Grade Master. Customer Market uses B-06 commercial fingerprint dedupe. Do NOT merge Grade Master records.',
        products: products.map((product) => ({
          productId: product.id,
          sku: product.code,
          name: product.name,
          organizationId: product.organizationId,
          organizationName: product.organization?.name ?? null,
          organizationCode: product.organization?.code ?? null,
          createdAt: product.createdAt,
          inventoryMt: product.inventory.reduce(
            (sum, row) => sum + Number(row.availableQty),
            0,
          ),
          activeOffers: product.offers.map((offer) => ({
            offerId: offer.id,
            price: Number(offer.basePrice),
            moq: Number(offer.moq),
            quantity: Number(offer.quantity),
          })),
        })),
      });
    }

    const sameOrgDupes = await prisma.$queryRaw<
      Array<{
        organization_id: string;
        grade_id: string;
        grade_code: string;
        product_count: bigint;
      }>
    >`
      SELECT
        p.organization_id,
        p.grade_id,
        g.code AS grade_code,
        COUNT(*)::bigint AS product_count
      FROM products p
      JOIN grades g ON g.id = p.grade_id
      WHERE p.deleted_at IS NULL
        AND p.status = ${ProductStatus.ACTIVE}::"ProductStatus"
      GROUP BY p.organization_id, p.grade_id, g.code
      HAVING COUNT(*) > 1
      ORDER BY product_count DESC
    `;

    const report = {
      generatedAt: new Date().toISOString(),
      summary: {
        crossOrgGradeGroups: details.length,
        sameOrgDuplicateGroups: sameOrgDupes.length,
        note: 'Cross-org listings are expected marketplace competition. Same-org duplicates should be paused via fix-duplicate-marketplace-listings.ts.',
      },
      crossOrgListings: details,
      sameOrgDuplicates: sameOrgDupes.map((row) => ({
        organizationId: row.organization_id,
        gradeId: row.grade_id,
        gradeCode: row.grade_code,
        productCount: Number(row.product_count),
        recommendation:
          'Run: npx tsx scripts/fix-duplicate-marketplace-listings.ts --dry-run',
      })),
    };

    if (OUT) {
      writeFileSync(OUT, JSON.stringify(report, null, 2));
      console.error(`Wrote ${OUT}`);
    }

    if (AS_JSON) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(
        `Cross-org Grade Master listings: ${report.summary.crossOrgGradeGroups}`,
      );
      console.log(
        `Same-org ACTIVE duplicates: ${report.summary.sameOrgDuplicateGroups}`,
      );
      for (const group of details.slice(0, 25)) {
        console.log(
          `\n${group.gradeCode} (${group.gradeName}) — ${group.productCount} products / ${group.orgCount} sellers`,
        );
        for (const product of group.products) {
          console.log(
            `  - ${product.sku} | org=${product.organizationCode ?? product.organizationId.slice(0, 8)} | offers=${product.activeOffers.length} | inv=${product.inventoryMt}`,
          );
        }
      }
      if (sameOrgDupes.length) {
        console.log('\nSame-org duplicates (safe to pause extras):');
        for (const row of report.sameOrgDuplicates) {
          console.log(
            `  ${row.gradeCode} org=${row.organizationId.slice(0, 8)} count=${row.productCount}`,
          );
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
