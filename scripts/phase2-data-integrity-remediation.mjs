#!/usr/bin/env node
/**
 * Phase 2 data-integrity remediation (MOQ tiers + expired ACTIVE offers).
 *
 * Default: dry-run only.
 * Apply:   APPLY=1 DATABASE_URL=... node scripts/phase2-data-integrity-remediation.mjs
 *
 * Does NOT delete grades or migrate SO- codes (those remain client-gated).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'tmp/phase2-remediation');
const APPLY = process.env.APPLY === '1' || process.env.APPLY === 'true';

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
    const { rows: badTiers } = await client.query(`
      SELECT t.id, t.offer_id, t.min_qty, t.max_qty, t.price, o.moq, o.status AS offer_status,
             o.reference_number
      FROM offer_price_tiers t
      JOIN offers o ON o.id = t.offer_id
      WHERE o.deleted_at IS NULL
        AND o.moq IS NOT NULL
        AND t.min_qty < o.moq
      ORDER BY o.reference_number, t.min_qty
    `);

    const { rows: expiredActive } = await client.query(`
      SELECT id, reference_number, status, valid_until, base_price
      FROM offers
      WHERE deleted_at IS NULL
        AND status = 'ACTIVE'
        AND valid_until IS NOT NULL
        AND valid_until < NOW()
    `);

    const { rows: countryRows } = await client.query(`
      SELECT country_of_origin AS value, COUNT(*)::int AS n
      FROM products
      WHERE deleted_at IS NULL AND country_of_origin IS NOT NULL
      GROUP BY 1
      ORDER BY n DESC
      LIMIT 30
    `);

    const plan = {
      generatedAt: new Date().toISOString(),
      mode: APPLY ? 'APPLY' : 'DRY_RUN',
      actions: {
        deleteInvalidMoqTiers: badTiers.map((t) => ({
          tierId: t.id,
          offerId: t.offer_id,
          reference: t.reference_number,
          minQty: t.min_qty,
          moq: t.moq,
          reason: 'tier_min_below_moq',
        })),
        expireOffers: expiredActive.map((o) => ({
          offerId: o.id,
          reference: o.reference_number,
          validUntil: o.valid_until,
          reason: 'valid_until_passed_while_active',
        })),
      },
      countryOfOriginDistribution: countryRows,
      notes: [
        'Country India/IN normalization is reported only — apply after client confirms canonical value.',
        'Grade cleanup and SO→PSX migration are intentionally excluded.',
      ],
    };

    writeFileSync(join(outDir, 'plan.json'), JSON.stringify(plan, null, 2));
    console.log(JSON.stringify(plan, null, 2));

    if (!APPLY) {
      console.log(`\nDry-run only. Re-run with APPLY=1 to execute. Wrote ${outDir}`);
      return;
    }

    await client.query('BEGIN');
    try {
      if (badTiers.length) {
        await client.query(
          `DELETE FROM offer_price_tiers WHERE id = ANY($1::uuid[])`,
          [badTiers.map((t) => t.id)],
        );
      }
      if (expiredActive.length) {
        await client.query(
          `UPDATE offers
           SET status = 'EXPIRED', updated_at = NOW()
           WHERE id = ANY($1::uuid[])`,
          [expiredActive.map((o) => o.id)],
        );
      }
      await client.query('COMMIT');
      console.log(
        `\nApplied: deleted ${badTiers.length} invalid tiers; expired ${expiredActive.length} offers.`,
      );
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
