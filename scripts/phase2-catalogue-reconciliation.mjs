#!/usr/bin/env node
/**
 * Phase 2 catalogue / pricing / TDS reconciliation (READ-ONLY).
 *
 * Emits DB-backed counts for:
 *  - catalogue grades, unique grades, live listings
 *  - duplicate / junk / invalid candidates (incl. client-suspected junk patterns)
 *  - SO- code coverage, manufacturer coverage, TDS coverage
 *  - invalid MOQ vs price-tier relationships
 *  - warehouse / origin consistency samples
 *  - Nylon/PA66 and Compound/Virgin heuristic flags (REVIEW ONLY — no auto-fix)
 *
 * Does NOT delete grades or migrate codes. Cleanup apply remains BLOCKED
 * without an approved client source list.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/phase2-catalogue-reconciliation.mjs
 *   npm run catalogue:phase2-report
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'tmp/phase2-reconciliation');

const JUNK_CATEGORY_PATTERNS = [
  'SUBSCRIPTION',
  'DISABLED',
  'GENERIC',
];

const SHORT_OR_TOKEN_CODES = new Set(['R', 'LL', 'TIO2', 'NA', 'N/A', 'TEST']);

function normalize(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (read-only).');
    process.exit(2);
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl:
      /sslmode=require|ondigitalocean|ssl=true/i.test(databaseUrl)
        ? { rejectUnauthorized: false }
        : undefined,
  });
  await client.connect();
  mkdirSync(outDir, { recursive: true });

  try {
    const freightFloor = Number(process.env.COMMERCE_FREIGHT_PER_MT ?? 1250);
    const now = new Date();

    const { rows: grades } = await client.query(`
      SELECT g.id, g.code, g.name, g.display_name, g.full_grade_name, g.grade_no,
             g.grade_group, g.manufacturer, g.hsn_code, g.status,
             g.customer_visible, g.seller_visible, g.source, g.source_key,
             c.code AS category_code, c.name AS category_name
      FROM grades g
      LEFT JOIN grade_categories c ON c.id = g.category_id
      WHERE g.deleted_at IS NULL
    `);

    const { rows: products } = await client.query(`
      SELECT id, code, name, status, grade_id, manufacturer, brand,
             country_of_origin, supply_origin, deleted_at
      FROM products
      WHERE deleted_at IS NULL
    `);

    const { rows: offers } = await client.query(`
      SELECT o.id, o.reference_number, o.status, o.base_price, o.quantity, o.moq,
             o.unit, o.product_id, o.grade_id, o.warehouse_id, o.visibility,
             o.valid_from, o.valid_until,
             w.name AS warehouse_name, w.city AS warehouse_city, w.state AS warehouse_state
      FROM offers o
      LEFT JOIN warehouses w ON w.id = o.warehouse_id
      WHERE o.deleted_at IS NULL
    `);

    const { rows: tiers } = await client.query(`
      SELECT t.id, t.offer_id, t.min_qty, t.max_qty, t.price, o.moq, o.status AS offer_status
      FROM offer_price_tiers t
      JOIN offers o ON o.id = t.offer_id
      WHERE o.deleted_at IS NULL
    `);

    const { rows: tdsDocs } = await client.query(`
      SELECT id, grade_id, grade_code, verification_status, storage_key, is_active, deleted_at
      FROM grade_tds_documents
      WHERE deleted_at IS NULL
    `);

    const activeGrades = grades.filter((g) => g.status === 'ACTIVE');
    const customerVisible = activeGrades.filter((g) => g.customer_visible);
    const soPrefixed = grades.filter((g) => String(g.code || '').startsWith('SO-'));
    const uniqueCodes = new Set(grades.map((g) => g.code).filter(Boolean));

    const junkCandidates = customerVisible.filter((g) => {
      const cat = normalize(g.category_code || g.category_name || '');
      const code = normalize(g.code);
      const name = normalize(g.name || g.display_name || g.grade_no);
      const group = normalize(g.grade_group);
      if (JUNK_CATEGORY_PATTERNS.some((p) => cat.includes(p) || group.includes(p))) {
        return true;
      }
      if (SHORT_OR_TOKEN_CODES.has(code) || SHORT_OR_TOKEN_CODES.has(name)) {
        return true;
      }
      if (/^SO-SUBSCRIPTION-|^SO-DISABLED-/.test(String(g.code || ''))) {
        return true;
      }
      return false;
    });

    // Heuristic “444 suspected” bucket: junk + missing maker + ultra-short grade_no
    const suspectedInvalid = [];
    const seenSuspected = new Set();
    for (const g of customerVisible) {
      const reasons = [];
      const cat = normalize(g.category_code || '');
      const code = String(g.code || '');
      const gradeNo = String(g.grade_no || g.name || '').trim();
      if (JUNK_CATEGORY_PATTERNS.some((p) => cat.includes(p))) {
        reasons.push('junk_category');
      }
      if (/^SO-SUBSCRIPTION-|^SO-DISABLED-/.test(code)) {
        reasons.push('junk_so_prefix');
      }
      if (!(g.manufacturer || '').trim()) reasons.push('missing_manufacturer');
      if (gradeNo.length <= 2) reasons.push('ultra_short_grade_no');
      if (SHORT_OR_TOKEN_CODES.has(normalize(gradeNo))) {
        reasons.push('token_grade');
      }
      if (reasons.length) {
        seenSuspected.add(g.id);
        suspectedInvalid.push({
          id: g.id,
          code: g.code,
          displayName: g.display_name || g.name,
          categoryCode: g.category_code,
          manufacturer: g.manufacturer,
          reasons,
          proposedAction: 'HIDE_CUSTOMER_VISIBLE_PENDING_CLIENT_LIST',
        });
      }
    }

    const byNorm = new Map();
    for (const g of grades) {
      const key = [
        normalize(g.manufacturer),
        normalize(g.grade_no || g.code || g.name),
        normalize(g.grade_group),
      ].join('|');
      if (!byNorm.has(key)) byNorm.set(key, []);
      byNorm.get(key).push(g);
    }
    const duplicateCandidates = [...byNorm.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([key, group]) => ({
        key,
        count: group.length,
        proposedAction: 'REVIEW_ONLY',
        ids: group.map((x) => x.id),
        codes: group.map((x) => x.code),
      }));

    const liveOffers = offers.filter((o) => {
      if (o.status !== 'ACTIVE') return false;
      if (o.visibility != null && o.visibility !== 'MARKETPLACE') return false;
      if (o.valid_until && new Date(o.valid_until) < now) return false;
      if (o.valid_from && new Date(o.valid_from) > now) return false;
      return true;
    });
    const expiredStillActive = offers.filter(
      (o) =>
        o.status === 'ACTIVE' &&
        o.valid_until &&
        new Date(o.valid_until) < now,
    );

    const invalidMoqTiers = tiers.filter((t) => {
      const moq = t.moq != null ? Number(t.moq) : null;
      const minQty = Number(t.min_qty);
      if (!(minQty > 0)) return true;
      if (moq != null && moq > 0 && minQty < moq) return true;
      return false;
    });

    const verifiedTds = tdsDocs.filter(
      (d) =>
        d.is_active &&
        d.verification_status === 'VERIFIED' &&
        d.storage_key,
    );
    const gradesWithTds = new Set(verifiedTds.map((d) => d.grade_id).filter(Boolean));

    const missingManufacturer = customerVisible.filter(
      (g) => !(g.manufacturer || '').trim(),
    );

    const nylonPa66Flags = products
      .filter((p) => /nylon\s*66/i.test(p.name || ''))
      .map((p) => {
        const grade = grades.find((g) => g.id === p.grade_id);
        return {
          productId: p.id,
          productName: p.name,
          gradeId: p.grade_id,
          gradeCode: grade?.code,
          gradeName: grade?.display_name || grade?.name,
          note: 'REVIEW: do not auto-equate Nylon 66 Injection with PA66 GF without client master data',
        };
      });

    const compoundVirginFlags = grades
      .filter((g) => {
        const hay = `${g.category_code || ''} ${g.grade_group || ''} ${g.display_name || ''}`;
        return /compound/i.test(hay);
      })
      .slice(0, 50)
      .map((g) => ({
        id: g.id,
        code: g.code,
        displayName: g.display_name,
        categoryCode: g.category_code,
        note: 'REVIEW: Compound vs Virgin classification needs master-data rule',
      }));

    const regionSamples = products
      .filter((p) => p.supply_origin || p.country_of_origin)
      .slice(0, 40)
      .map((p) => ({
        id: p.id,
        name: p.name,
        countryOfOrigin: p.country_of_origin,
        supplyOrigin: p.supply_origin,
      }));

    const warehouseCoverage = {
      liveOffersWithWarehouse: liveOffers.filter((o) => o.warehouse_id).length,
      liveOffersMissingWarehouse: liveOffers.filter((o) => !o.warehouse_id).length,
      distinctWarehouses: new Set(
        liveOffers.map((o) => o.warehouse_id).filter(Boolean),
      ).size,
    };

    // Optional client approved hide list
    const approvedListPath = process.env.CLIENT_JUNK_GRADE_LIST;
    let approvedListCompare = {
      provided: false,
      path: approvedListPath || null,
      matchedIds: 0,
      unmatchedListCodes: [],
    };
    if (approvedListPath && existsSync(approvedListPath)) {
      const raw = readFileSync(approvedListPath, 'utf8');
      const codes = raw
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const byCode = new Map(grades.map((g) => [String(g.code), g]));
      const matched = [];
      const unmatched = [];
      for (const code of codes) {
        if (byCode.has(code)) matched.push(code);
        else unmatched.push(code);
      }
      approvedListCompare = {
        provided: true,
        path: approvedListPath,
        listSize: codes.length,
        matchedIds: matched.length,
        unmatchedListCodes: unmatched.slice(0, 100),
      };
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      mode: 'phase2-read-only-reconciliation',
      destructive: false,
      cleanupApplyStatus: 'BLOCKED_PENDING_CLIENT_APPROVED_SOURCE_LIST',
      gradeCodeMigrationStatus: 'BLOCKED_PENDING_CLIENT_FORMAT_APPROVAL',
      tdsBulkImportStatus: 'BLOCKED_PENDING_CLIENT_PDF_PACK',
      freightFloorPerMt: freightFloor,
      totals: {
        catalogueGradesAll: grades.length,
        uniqueGradeCodes: uniqueCodes.size,
        activeGrades: activeGrades.length,
        customerVisibleGrades: customerVisible.length,
        soPrefixedCodes: soPrefixed.length,
        soPrefixedCustomerVisible: soPrefixed.filter((g) => g.customer_visible)
          .length,
        productsActive: products.filter((p) => p.status === 'ACTIVE').length,
        liveListings: liveOffers.length,
        liveListingsPriceSane: liveOffers.filter(
          (o) => Number(o.base_price) >= freightFloor,
        ).length,
        duplicateGradeCandidateGroups: duplicateCandidates.length,
        junkCategoryCandidates: junkCandidates.length,
        suspectedInvalidCandidates: suspectedInvalid.length,
        clientReportedSuspectedTarget: 444,
        suspectedVsClient444Delta: suspectedInvalid.length - 444,
        missingManufacturers: missingManufacturer.length,
        manufacturerCoveragePct: customerVisible.length
          ? Number(
              (
                ((customerVisible.length - missingManufacturer.length) /
                  customerVisible.length) *
                100
              ).toFixed(2),
            )
          : 0,
        verifiedTdsDocuments: verifiedTds.length,
        gradesWithVerifiedTds: gradesWithTds.size,
        tdsCoveragePctOfCustomerVisible: customerVisible.length
          ? Number(
              ((gradesWithTds.size / customerVisible.length) * 100).toFixed(2),
            )
          : 0,
        invalidMoqPriceTiers: invalidMoqTiers.length,
        expiredOffersStillActive: expiredStillActive.length,
      },
      warehouseCoverage,
      approvedListCompare,
      notes: [
        'Counts come from live DATABASE_URL queries — not hardcoded catalogue sizes.',
        'Suspected-invalid list is heuristic; do not mass-delete without approved CSV.',
        'Client reported ~444 junk/generic/duplicate — compare totals.suspectedInvalidCandidates.',
        'Grade-code migration dry-run is a separate script (catalogue:grade-code-dry-run).',
        'TDS bulk import awaits ~550 client PDFs; do not fabricate documents.',
      ],
    };

    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    writeFileSync(
      join(outDir, 'junk-category-candidates.json'),
      JSON.stringify(junkCandidates.slice(0, 1000), null, 2),
    );
    writeFileSync(
      join(outDir, 'suspected-invalid-candidates.json'),
      JSON.stringify(suspectedInvalid, null, 2),
    );
    writeFileSync(
      join(outDir, 'duplicate-grade-candidates.json'),
      JSON.stringify(duplicateCandidates, null, 2),
    );
    writeFileSync(
      join(outDir, 'invalid-moq-price-tiers.json'),
      JSON.stringify(invalidMoqTiers.slice(0, 500), null, 2),
    );
    writeFileSync(
      join(outDir, 'expired-offers-still-active.json'),
      JSON.stringify(expiredStillActive, null, 2),
    );
    writeFileSync(
      join(outDir, 'nylon-pa66-review.json'),
      JSON.stringify(nylonPa66Flags, null, 2),
    );
    writeFileSync(
      join(outDir, 'compound-virgin-review.json'),
      JSON.stringify(compoundVirginFlags, null, 2),
    );
    writeFileSync(
      join(outDir, 'region-origin-samples.json'),
      JSON.stringify(regionSamples, null, 2),
    );

    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nWrote Phase 2 reports to ${outDir}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
