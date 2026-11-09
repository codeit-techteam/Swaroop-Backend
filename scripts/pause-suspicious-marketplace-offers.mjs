#!/usr/bin/env node
/**
 * Soft-pause ACTIVE marketplace offers priced below the commerce freight floor.
 *
 * SAFE defaults: dry-run only. Pass --apply to write.
 * Never hard-deletes. Preserves purchase_request_items / order history.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/pause-suspicious-marketplace-offers.mjs
 *   DATABASE_URL=... node scripts/pause-suspicious-marketplace-offers.mjs --apply
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'tmp/catalogue-dry-run');
const apply = process.argv.includes('--apply');
const freightFloor = Number(process.env.COMMERCE_FREIGHT_PER_MT ?? 1250);

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
    const { rows: targets } = await client.query(
      `
      SELECT o.id, o.reference_number, o.status, o.base_price, o.unit, o.metadata,
             o.organization_id,
             p.name AS product_name, g.display_name AS grade_display,
             (SELECT COUNT(*)::int FROM purchase_request_items pri WHERE pri.offer_id = o.id) AS pr_item_refs,
             (SELECT COUNT(*)::int FROM cart_items ci WHERE ci.offer_id = o.id) AS cart_refs,
             (SELECT COUNT(*)::int FROM checkout_quotes cq WHERE cq.offer_id = o.id) AS quote_refs
      FROM offers o
      LEFT JOIN products p ON p.id = o.product_id
      LEFT JOIN grades g ON g.id = o.grade_id
      WHERE o.deleted_at IS NULL
        AND o.status = 'ACTIVE'
        AND o.base_price > 0
        AND o.base_price < $1
      ORDER BY o.base_price ASC
      `,
      [freightFloor],
    );

    const plan = {
      generatedAt: new Date().toISOString(),
      mode: apply ? 'apply' : 'dry-run',
      freightFloorPerMt: freightFloor,
      action: 'PAUSE (soft) — preserve rows and PR/order references',
      targets: targets.map((row) => ({
        id: row.id,
        referenceNumber: row.reference_number,
        basePrice: String(row.base_price),
        unit: row.unit,
        productName: row.product_name,
        gradeDisplay: row.grade_display,
        prItemRefs: row.pr_item_refs,
        cartRefs: row.cart_refs,
        quoteRefs: row.quote_refs,
        proposedAction: 'PAUSE',
      })),
    };

    writeFileSync(
      join(outDir, 'pause-suspicious-offers-plan.json'),
      JSON.stringify(plan, null, 2),
    );
    console.log(JSON.stringify(plan, null, 2));

    if (!apply) {
      console.log(
        '\nDry-run only. Re-run with --apply to soft-pause these offers.',
      );
      return;
    }

    if (targets.length === 0) {
      console.log('Nothing to pause.');
      return;
    }

    const results = [];
    await client.query('BEGIN');
    try {
      for (const row of targets) {
        const reason = `Material price (₹${Number(row.base_price).toFixed(2)}/MT) is below platform freight floor (₹${freightFloor}/MT)`;
        const prevMeta =
          row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
            ? row.metadata
            : {};
        const nextMeta = {
          ...prevMeta,
          needsPriceReview: true,
          priceReviewReason: reason,
          pricingUnit: 'MT',
          pausedByCleanup: true,
          pausedByCleanupAt: new Date().toISOString(),
          pausedByCleanupScript: 'pause-suspicious-marketplace-offers.mjs',
        };

        const updated = await client.query(
          `
          UPDATE offers
          SET status = 'PAUSED',
              metadata = $2::jsonb,
              updated_at = NOW()
          WHERE id = $1
            AND deleted_at IS NULL
            AND status = 'ACTIVE'
          RETURNING id, reference_number, status, base_price, organization_id
          `,
          [row.id, JSON.stringify(nextMeta)],
        );

        results.push({
          ...(updated.rows[0] ?? { id: row.id, status: 'PAUSED' }),
          reason,
          prItemRefs: row.pr_item_refs,
          organization_id: row.organization_id,
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    for (const row of results) {
      try {
        await client.query(
          `
          INSERT INTO audit_logs (
            id, action, actor_user_id, organization_id, entity_type, entity_id,
            previous_data, new_data, metadata, created_at
          ) VALUES (
            gen_random_uuid(),
            'OFFER_PAUSED_PRICE_REVIEW',
            NULL,
            $1,
            'OFFER',
            $2,
            $3::jsonb,
            $4::jsonb,
            $5::jsonb,
            NOW()
          )
          `,
          [
            row.organization_id ?? null,
            row.id,
            JSON.stringify({ status: 'ACTIVE', basePrice: String(row.base_price) }),
            JSON.stringify({
              status: 'PAUSED',
              basePrice: String(row.base_price),
              reason: row.reason,
            }),
            JSON.stringify({
              script: 'pause-suspicious-marketplace-offers.mjs',
              freightFloor,
              prItemRefs: row.prItemRefs,
            }),
          ],
        );
      } catch (error) {
        console.warn(
          `audit_logs insert skipped for ${row.reference_number}: ${error.message}`,
        );
      }
    }

    writeFileSync(
      join(outDir, 'pause-suspicious-offers-result.json'),
      JSON.stringify(
        { appliedAt: new Date().toISOString(), results },
        null,
        2,
      ),
    );
    console.log('\nPaused offers:');
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
