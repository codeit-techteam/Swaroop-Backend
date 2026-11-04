#!/usr/bin/env node
/**
 * Dry-run catalogue / market listing cleanup report (4 Nov 2026 client feedback).
 *
 * SAFE: read-only. Does not merge, delete, invent HSN/manufacturers, or change prices.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/dry-run-catalogue-cleanup.mjs
 *
 * Outputs JSON summary to stdout and writes reports under ./tmp/catalogue-dry-run/
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'tmp', 'catalogue-dry-run');

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
        SELECT id, code, name, "displayName", "fullGradeName", "gradeNo", "gradeGroup",
               manufacturer, "hsnCode", status, "deletedAt"
        FROM "Grade"
        WHERE "deletedAt" IS NULL
      `)
    ).rows;

    const offers = (
      await client.query(`
        SELECT o.id, o."referenceNumber", o.status, o."basePrice", o.quantity, o.moq,
               o."createdAt", o."productId", o."gradeId", o."organizationId",
               g.code AS grade_code, g."displayName" AS grade_display,
               g.manufacturer AS grade_manufacturer,
               p.name AS product_name, p.manufacturer AS product_manufacturer
        FROM "Offer" o
        LEFT JOIN "Grade" g ON g.id = o."gradeId"
        LEFT JOIN "Product" p ON p.id = o."productId"
        WHERE o."deletedAt" IS NULL
          AND o.status IN ('ACTIVE', 'PUBLISHED', 'LIVE')
      `)
    ).rows;

    // Near-duplicate grade candidates (normalized code / gradeNo + manufacturer)
    const byNorm = new Map();
    for (const grade of grades) {
      const key = [
        normalizeMaker(grade.manufacturer),
        normalizeGradeKey(grade.gradeNo || grade.code || grade.name),
        normalizeGradeKey(grade.gradeGroup || ''),
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
        ids: group.map((g) => g.id),
        labels: group.map(
          (g) => g.fullGradeName || g.displayName || g.name || g.code,
        ),
      }));

    const genericGrades = grades.filter((g) => {
      const maker = (g.manufacturer || '').trim();
      const code = (g.gradeNo || g.code || '').trim();
      return !maker || !code || /^generic$/i.test(maker);
    });

    const missingManufacturers = grades.filter(
      (g) => !(g.manufacturer || '').trim(),
    );
    const missingHsn = grades.filter((g) => !(g.hsnCode || '').trim());

    const suspiciousLowPrice = offers.filter(
      (o) => Number(o.basePrice) > 0 && Number(o.basePrice) < 100,
    );

    const absTestOffers = offers.filter((o) => {
      const hay = `${o.grade_display || ''} ${o.product_name || ''} ${o.grade_code || ''}`.toUpperCase();
      return hay.includes('3000D') && Number(o.basePrice) === 10;
    });

    const liveListingCount = offers.length;
    const gradesWithLiveOffers = new Set(
      offers.map((o) => o.gradeId).filter(Boolean),
    ).size;

    const manufacturerBuckets = new Map();
    for (const o of offers) {
      const label = (o.grade_manufacturer || o.product_manufacturer || 'UNKNOWN').trim() || 'UNKNOWN';
      manufacturerBuckets.set(label, (manufacturerBuckets.get(label) || 0) + 1);
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      mode: 'dry-run',
      destructive: false,
      totals: {
        catalogueGrades: grades.length,
        liveListings: liveListingCount,
        gradesCoveredByLiveListings: gradesWithLiveOffers,
        duplicateGradeCandidateGroups: duplicateCandidates.length,
        genericGradeCandidates: genericGrades.length,
        missingManufacturers: missingManufacturers.length,
        missingHsnCodes: missingHsn.length,
        suspiciousLowPriceOffers: suspiciousLowPrice.length,
        abs3000dAtTenRupees: absTestOffers.length,
      },
      manufacturerBuckets: Object.fromEntries(
        [...manufacturerBuckets.entries()].sort((a, b) => b[1] - a[1]),
      ),
      notes: [
        'No merges, deletes, HSN inventions, or price changes were applied.',
        'Confirm commercial ABS EXTRUSION 3000D price before deactivating ₹10 test offers.',
        'Require DB backup + explicit approval before any write migration.',
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
          displayName: g.displayName,
          manufacturer: g.manufacturer,
        })),
        null,
        2,
      ),
    );
    writeFileSync(
      join(outDir, 'missing-manufacturers.json'),
      JSON.stringify(
        missingManufacturers.map((g) => ({ id: g.id, code: g.code, name: g.name })),
        null,
        2,
      ),
    );
    writeFileSync(
      join(outDir, 'missing-hsn.json'),
      JSON.stringify(
        missingHsn.slice(0, 500).map((g) => ({ id: g.id, code: g.code, name: g.name })),
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
