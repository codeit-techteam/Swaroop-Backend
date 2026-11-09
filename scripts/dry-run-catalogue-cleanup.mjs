#!/usr/bin/env node
/**
 * Dry-run catalogue / market listing cleanup report.
 *
 * SAFE: read-only. Does not merge, delete, invent HSN/manufacturers, or change prices.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/dry-run-catalogue-cleanup.mjs
 *
 * Uses Prisma @@map table/column names (snake_case).
 * Outputs JSON summary to stdout and writes reports under ./tmp/catalogue-dry-run/
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'tmp/catalogue-dry-run');

function normalizeGradeKey(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeMaker(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required. This script is read-only but needs DB access.');
    console.error('Do not run destructive cleanup without backup + explicit approval.');
    process.exit(2);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    mkdirSync(outDir, { recursive: true });

    const grades = (
      await client.query(`
        SELECT id, code, name, display_name, full_grade_name, grade_no, grade_group,
               manufacturer, hsn_code, status, customer_visible, deleted_at
        FROM grades
        WHERE deleted_at IS NULL
      `)
    ).rows;

    const offers = (
      await client.query(`
        SELECT o.id, o.reference_number, o.status, o.base_price, o.quantity, o.moq,
               o.unit, o.created_at, o.product_id, o.grade_id, o.organization_id,
               o.visibility, o.valid_from, o.valid_until,
               g.code AS grade_code, g.display_name AS grade_display,
               g.full_grade_name AS grade_full, g.manufacturer AS grade_manufacturer,
               p.name AS product_name, p.manufacturer AS product_manufacturer
        FROM offers o
        LEFT JOIN grades g ON g.id = o.grade_id
        LEFT JOIN products p ON p.id = o.product_id
        WHERE o.deleted_at IS NULL
          AND o.status = 'ACTIVE'
      `)
    ).rows;

    const freightFloor = Number(process.env.COMMERCE_FREIGHT_PER_MT ?? 1250);

    const byNorm = new Map();
    for (const grade of grades) {
      const key = [
        normalizeMaker(grade.manufacturer),
        normalizeGradeKey(grade.grade_no || grade.code || grade.name),
        normalizeGradeKey(grade.grade_group || ''),
      ].join('|');
      if (!byNorm.has(key)) byNorm.set(key, []);
      byNorm.get(key).push(grade);
    }
    const duplicateCandidates = [...byNorm.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([key, group]) => ({
        key,
        count: group.length,
        proposedCanonicalId: group[0].id,
        proposedAction: 'REVIEW_ONLY',
        ids: group.map((g) => g.id),
        labels: group.map(
          (g) => g.full_grade_name || g.display_name || g.name || g.code,
        ),
        customerVisible: group.map((g) => g.customer_visible),
        statuses: group.map((g) => g.status),
      }));

    const genericGrades = grades.filter((g) => {
      const maker = (g.manufacturer || '').trim();
      const code = (g.grade_no || g.code || '').trim();
      return !maker || !code || /^generic$/i.test(maker);
    });

    const missingManufacturers = grades.filter(
      (g) => !(g.manufacturer || '').trim(),
    );
    const missingHsn = grades.filter((g) => !(g.hsn_code || '').trim());

    const suspiciousLowPrice = offers.filter(
      (o) => Number(o.base_price) > 0 && Number(o.base_price) < freightFloor,
    );

    const absTestOffers = offers.filter((o) => {
      const hay =
        `${o.grade_display || ''} ${o.grade_full || ''} ${o.product_name || ''} ${o.grade_code || ''}`.toUpperCase();
      return hay.includes('3000D') && Number(o.base_price) === 10;
    });

    const now = Date.now();
    const liveWindow = offers.filter((o) => {
      const visOk = o.visibility == null || o.visibility === 'MARKETPLACE';
      const untilOk = !o.valid_until || new Date(o.valid_until).getTime() >= now;
      const fromOk = !o.valid_from || new Date(o.valid_from).getTime() <= now;
      return visOk && untilOk && fromOk;
    });

    const gradesActive = grades.filter((g) => g.status === 'ACTIVE');
    const gradesCustomerVisible = gradesActive.filter((g) => g.customer_visible);
    const gradesActiveHidden = gradesActive.filter((g) => !g.customer_visible);

    const manufacturerBuckets = new Map();
    for (const o of liveWindow) {
      const label =
        (o.grade_manufacturer || o.product_manufacturer || 'UNKNOWN').trim() ||
        'UNKNOWN';
      manufacturerBuckets.set(label, (manufacturerBuckets.get(label) || 0) + 1);
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      mode: 'dry-run',
      destructive: false,
      freightFloorPerMt: freightFloor,
      countingPolicy: {
        customerCatalogueGrades:
          'grades.deleted_at IS NULL AND status=ACTIVE AND customer_visible=true',
        sellerCatalogueGrades:
          'grades.deleted_at IS NULL AND status=ACTIVE (includes customer_visible=false)',
        liveListings:
          'offers.deleted_at IS NULL AND status=ACTIVE AND marketplace visibility AND validity window',
        liveListingsPriceSane: `liveListings AND base_price >= ${freightFloor}`,
      },
      totals: {
        catalogueGradesAll: grades.length,
        sellerActiveGrades: gradesActive.length,
        customerVisibleCatalogueGrades: gradesCustomerVisible.length,
        activeHiddenFromCustomer: gradesActiveHidden.length,
        liveListings: liveWindow.length,
        liveListingsPriceSane: liveWindow.filter(
          (o) => Number(o.base_price) >= freightFloor,
        ).length,
        gradesCoveredByLiveListings: new Set(
          liveWindow.map((o) => o.grade_id).filter(Boolean),
        ).size,
        duplicateGradeCandidateGroups: duplicateCandidates.length,
        genericGradeCandidates: genericGrades.length,
        missingManufacturers: missingManufacturers.length,
        missingHsnCodes: missingHsn.length,
        suspiciousLowPriceOffers: suspiciousLowPrice.length,
        abs3000dAtTenRupees: absTestOffers.length,
      },
      expectedClientLabels: {
        customerCatalogueGrades: 3748,
        liveListings: 124,
        sellerCatalogue: 3750,
      },
      reconciliation: {
        customerCatalogueMatchesExpected:
          gradesCustomerVisible.length === 3748,
        sellerActiveVsClient3750Delta: gradesActive.length - 3750,
        liveListingsVsClient124Delta: liveWindow.length - 124,
      },
      activeHiddenGrades: gradesActiveHidden.map((g) => ({
        id: g.id,
        code: g.code,
        displayName: g.display_name,
        manufacturer: g.manufacturer,
      })),
      manufacturerBuckets: Object.fromEntries(
        [...manufacturerBuckets.entries()].sort((a, b) => b[1] - a[1]),
      ),
      notes: [
        'No merges, deletes, HSN inventions, or price changes were applied.',
        'Duplicate candidates are heuristic — many pairs are legitimate near-names, not true duplicates.',
        'Require DB backup + explicit approval before any hard-delete.',
        'Below-freight ACTIVE offers should be PAUSED (soft), never hard-deleted when PR/order refs exist.',
      ],
    };

    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    writeFileSync(
      join(outDir, 'duplicate-grade-candidates.json'),
      JSON.stringify(duplicateCandidates, null, 2),
    );
    writeFileSync(
      join(outDir, 'generic-grades.json'),
      JSON.stringify(
        genericGrades.map((g) => ({
          id: g.id,
          code: g.code,
          displayName: g.display_name,
          manufacturer: g.manufacturer,
        })),
        null,
        2,
      ),
    );
    writeFileSync(
      join(outDir, 'missing-manufacturers.json'),
      JSON.stringify(
        missingManufacturers.map((g) => ({
          id: g.id,
          code: g.code,
          name: g.name,
        })),
        null,
        2,
      ),
    );
    writeFileSync(
      join(outDir, 'missing-hsn.json'),
      JSON.stringify(
        missingHsn.slice(0, 500).map((g) => ({
          id: g.id,
          code: g.code,
          name: g.name,
        })),
        null,
        2,
      ),
    );
    writeFileSync(
      join(outDir, 'suspicious-low-price-offers.json'),
      JSON.stringify(suspiciousLowPrice, null, 2),
    );
    writeFileSync(
      join(outDir, 'abs-3000d-ten-rupee-offers.json'),
      JSON.stringify(absTestOffers, null, 2),
    );

    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nWrote reports to ${outDir}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
