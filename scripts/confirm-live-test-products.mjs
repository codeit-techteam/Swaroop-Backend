#!/usr/bin/env node
/**
 * Read-only confirmation of client-reported test products on the live public API.
 * Does not need DATABASE_URL. Writes a dry-run plan for ops.
 *
 * Usage:
 *   node scripts/confirm-live-test-products.mjs
 *   API_BASE=https://swaroop-backend-xzwkz.ondigitalocean.app/api/v1 node scripts/confirm-live-test-products.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'tmp/catalogue-dry-run');
const API_BASE = (
  process.env.API_BASE ??
  'https://swaroop-backend-xzwkz.ondigitalocean.app/api/v1'
).replace(/\/$/, '');

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

async function fetchJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`${path} → HTTP ${res.status}`);
  }
  return res.json();
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const home = await fetchJson('/public/marketplace');
  const summary = home?.data?.summary ?? null;

  const found = [];
  let page = 1;
  let totalPages = 1;
  do {
    const payload = await fetchJson(
      `/public/marketplace/products?page=${page}&limit=100`,
    );
    const items = payload?.data ?? [];
    totalPages = payload?.meta?.totalPages ?? 1;
    for (const item of items) {
      const hit = CONFIRMED.find(
        (c) =>
          c.id === item.id ||
          (c.code === item.code &&
            String(item.name || '').toLowerCase() === c.name.toLowerCase()),
      );
      if (hit) {
        found.push({
          id: item.id,
          code: item.code,
          name: item.name,
          status: item.status,
          gradeId: item.grade?.id ?? null,
          gradeName: item.grade?.displayName || item.grade?.name || null,
          matchedRule: hit.name,
        });
      }
    }
    page += 1;
  } while (page <= totalPages && page <= 20);

  const plan = {
    generatedAt: new Date().toISOString(),
    mode: 'live-api-confirm',
    apiBase: API_BASE,
    summary,
    confirmedClientTargets: CONFIRMED,
    stillPublic: found,
    missingFromPublicApi: CONFIRMED.filter(
      (c) => !found.some((f) => f.id === c.id || f.name === c.name),
    ),
    nextStep:
      found.length === 0
        ? 'No confirmed test products on public API — cleanup may already be applied.'
        : 'Provide production DATABASE_URL, take a managed backup, then run: DATABASE_URL=... node scripts/soft-deactivate-confirmed-test-products.mjs --apply',
  };

  const outPath = join(outDir, 'live-test-products-confirm.json');
  writeFileSync(outPath, JSON.stringify(plan, null, 2));
  console.log(JSON.stringify(plan, null, 2));
  console.error(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
