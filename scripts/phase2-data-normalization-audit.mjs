#!/usr/bin/env node
/**
 * Phase 2 data-normalization audit (READ-ONLY).
 * Flags India/IN, region-vs-country, warehouse vs dispatch, Nylon/PA66,
 * Compound vs Virgin — for client review. Does not auto-rewrite grades.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'tmp/phase2-normalization');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(2);
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl:
      /sslmode=require|ondigitalocean/i.test(databaseUrl)
        ? { rejectUnauthorized: false }
        : undefined,
  });
  await client.connect();
  mkdirSync(outDir, { recursive: true });

  try {
    const { rows: countryDist } = await client.query(`
      SELECT COALESCE(country_of_origin, '(null)') AS country_of_origin,
             COALESCE(supply_origin, '(null)') AS supply_origin,
             COUNT(*)::int AS n
      FROM products WHERE deleted_at IS NULL
      GROUP BY 1, 2 ORDER BY n DESC
    `);

    const { rows: indiaVariants } = await client.query(`
      SELECT id, code, name, country_of_origin, supply_origin
      FROM products
      WHERE deleted_at IS NULL
        AND (
          LOWER(COALESCE(country_of_origin,'')) IN ('india','in','ind')
          OR LOWER(COALESCE(supply_origin,'')) IN ('india','in','ind','domestic')
        )
      ORDER BY name
      LIMIT 200
    `);

    const { rows: nylonFlags } = await client.query(`
      SELECT p.id AS product_id, p.name AS product_name, p.code AS product_code,
             g.id AS grade_id, g.code AS grade_code, g.name AS grade_name,
             g.grade_group, g.grade_no, c.code AS category_code
      FROM products p
      JOIN grades g ON g.id = p.grade_id
      LEFT JOIN grade_categories c ON c.id = g.category_id
      WHERE p.deleted_at IS NULL AND g.deleted_at IS NULL
        AND (
          p.name ILIKE '%nylon%' OR g.name ILIKE '%nylon%'
          OR g.display_name ILIKE '%nylon%' OR g.grade_group ILIKE '%nylon%'
          OR g.grade_group ILIKE '%PA66%' OR g.grade_no ILIKE '%PA66%'
          OR c.code ILIKE '%PA%' OR c.code ILIKE '%NYLON%'
        )
      ORDER BY p.name
      LIMIT 100
    `);

    const { rows: compoundFlags } = await client.query(`
      SELECT g.id, g.code, g.name, g.display_name, g.grade_group, c.code AS category_code
      FROM grades g
      LEFT JOIN grade_categories c ON c.id = g.category_id
      WHERE g.deleted_at IS NULL
        AND (
          g.grade_group ILIKE '%compound%'
          OR g.name ILIKE '%compound%'
          OR c.name ILIKE '%compound%'
          OR c.code ILIKE '%COMPOUND%'
        )
      ORDER BY g.code
      LIMIT 100
    `);

    const { rows: warehouseVsOrigin } = await client.query(`
      SELECT o.id, o.reference_number, w.name AS warehouse_name, w.city, w.state,
             p.country_of_origin, p.supply_origin, p.name AS product_name
      FROM offers o
      JOIN products p ON p.id = o.product_id
      LEFT JOIN warehouses w ON w.id = o.warehouse_id
      WHERE o.deleted_at IS NULL AND o.status = 'ACTIVE'
      ORDER BY o.reference_number
      LIMIT 80
    `);

    const summary = {
      generatedAt: new Date().toISOString(),
      mode: 'read-only-normalization-audit',
      applyStatus: 'BLOCKED_PENDING_CLIENT_MASTER_DATA',
      proposedCanonical: {
        countryOfOrigin: 'IN (ISO) with display label India',
        note: 'Do not rewrite without client-approved master rule',
      },
      totals: {
        countrySupplyCombos: countryDist.length,
        indiaOrDomesticProductSamples: indiaVariants.length,
        nylonPaReviewRows: nylonFlags.length,
        compoundReviewRows: compoundFlags.length,
      },
      countrySupplyDistribution: countryDist,
      notes: [
        'Do not infer technical equivalence (e.g. Nylon 66 Injection ≡ PA66 GF).',
        'Compound vs Virgin needs an authoritative material-class column or client list.',
      ],
    };

    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    writeFileSync(
      join(outDir, 'india-in-variants.json'),
      JSON.stringify(indiaVariants, null, 2),
    );
    writeFileSync(
      join(outDir, 'nylon-pa66-review.json'),
      JSON.stringify(nylonFlags, null, 2),
    );
    writeFileSync(
      join(outDir, 'compound-virgin-review.json'),
      JSON.stringify(compoundFlags, null, 2),
    );
    writeFileSync(
      join(outDir, 'warehouse-vs-origin-samples.json'),
      JSON.stringify(warehouseVsOrigin, null, 2),
    );

    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nWrote ${outDir}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
