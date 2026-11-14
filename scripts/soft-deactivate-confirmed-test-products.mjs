#!/usr/bin/env node
/**
 * Soft-deactivate confirmed public test products reported by client (14 Nov 2026).
 *
 * Targets (exact match on product id OR code+name):
 *   - E2E Bulk Pricing Test  (code E2E-BULK-14198)
 *   - HD Blow Test           (code HDPE_BLOW, name "HD Blow Test")
 *
 * SAFE defaults: dry-run only. Pass --apply to write.
 * - Soft-deletes products (deleted_at) and pauses ACTIVE offers on those products.
 * - Does NOT delete the genuine grade "HD Blow" (displayName).
 * - Preserves purchase_request / order / cart references.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/soft-deactivate-confirmed-test-products.mjs
 *   DATABASE_URL=... node scripts/soft-deactivate-confirmed-test-products.mjs --apply
 *
 * Also writes:
 *   tmp/catalogue-dry-run/test-products-cleanup-plan.json
 *   tmp/catalogue-dry-run/test-products-cleanup-result.json (on --apply)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'tmp/catalogue-dry-run');
const apply = process.argv.includes('--apply');

const CONFIRMED = [
  {
    id: '97625de6-82b0-4b3a-97f3-f2410b500011',
    code: 'E2E-BULK-14198',
    name: 'E2E Bulk Pricing Test',
  },
  {
    id: '6facf910-95c3-4d83-abd9-48ad7f78ebea',
    code: 'HDPE_BLOW',
    name: 'HD Blow Test',
  },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(2);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  mkdirSync(outDir, { recursive: true });

  try {
    const ids = CONFIRMED.map((c) => c.id);
    const { rows: products } = await client.query(
      `
      SELECT p.id, p.code, p.name, p.status, p.deleted_at,
             g.id AS grade_id, g.code AS grade_code, g.display_name AS grade_display,
             (SELECT COUNT(*)::int FROM offers o WHERE o.product_id = p.id AND o.deleted_at IS NULL) AS offer_count,
             (SELECT COUNT(*)::int FROM offers o WHERE o.product_id = p.id AND o.deleted_at IS NULL AND o.status = 'ACTIVE') AS active_offer_count,
             (SELECT COUNT(*)::int FROM purchase_request_items pri
                JOIN offers o ON o.id = pri.offer_id WHERE o.product_id = p.id) AS pr_item_refs,
             (SELECT COUNT(*)::int FROM cart_items ci
                JOIN offers o ON o.id = ci.offer_id WHERE o.product_id = p.id) AS cart_refs
      FROM products p
      LEFT JOIN grades g ON g.id = p.grade_id
      WHERE p.id = ANY($1::uuid[])
         OR (p.code = 'E2E-BULK-14198' AND p.name ILIKE 'E2E Bulk Pricing Test')
         OR (p.code = 'HDPE_BLOW' AND p.name ILIKE 'HD Blow Test')
      `,
      [ids],
    );

    // Safety: never touch products that are not in the confirmed name set
    const allowedNames = new Set(CONFIRMED.map((c) => c.name.toLowerCase()));
    const targets = products.filter((p) =>
      allowedNames.has(String(p.name || '').toLowerCase()),
    );

    const plan = {
      generatedAt: new Date().toISOString(),
      mode: apply ? 'apply' : 'dry-run',
      action:
        'SOFT-DELETE products (deleted_at) + PAUSE active offers — preserve PR/order/cart refs; leave grade HD Blow intact',
      confirmedClientTargets: CONFIRMED,
      matched: targets,
      skippedNonExactName: products.filter(
        (p) => !allowedNames.has(String(p.name || '').toLowerCase()),
      ),
    };

    writeFileSync(
      join(outDir, 'test-products-cleanup-plan.json'),
      JSON.stringify(plan, null, 2),
    );
    console.log(JSON.stringify(plan, null, 2));

    if (!apply) {
      console.error(
        '\nDry-run only. Re-run with --apply and a production DATABASE_URL to write.',
      );
      return;
    }

    if (targets.length === 0) {
      console.error('No confirmed targets matched — nothing applied.');
      return;
    }

    await client.query('BEGIN');
    const productIds = targets.map((t) => t.id);

    const pausedOffers = await client.query(
      `
      UPDATE offers
      SET status = 'PAUSED',
          updated_at = NOW(),
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'pausedReason', 'confirmed_test_product_cleanup_2026-11-14',
            'pausedAt', NOW()::text
          )
      WHERE product_id = ANY($1::uuid[])
        AND deleted_at IS NULL
        AND status = 'ACTIVE'
      RETURNING id, reference_number, product_id
      `,
      [productIds],
    );

    const softDeleted = await client.query(
      `
      UPDATE products
      SET deleted_at = NOW(),
          status = 'ARCHIVED',
          updated_at = NOW()
      WHERE id = ANY($1::uuid[])
        AND deleted_at IS NULL
      RETURNING id, code, name
      `,
      [productIds],
    );

    await client.query('COMMIT');

    const result = {
      appliedAt: new Date().toISOString(),
      pausedOffers: pausedOffers.rows,
      softDeletedProducts: softDeleted.rows,
    };
    writeFileSync(
      join(outDir, 'test-products-cleanup-result.json'),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
