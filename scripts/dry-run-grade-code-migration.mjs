#!/usr/bin/env node
/**
 * Dry-run PolyStoreX grade-code migration proposal.
 *
 * Does NOT write to the database. Does NOT simply replace SO- with PS-.
 *
 * Proposed format (requires client approval before production apply):
 *   PSX-{FAMILY}-{GRADE_TOKEN}-{SEQ4}
 * where:
 *   FAMILY = normalized grade_group / category parent (e.g. ABS, HDPE, PP)
 *   GRADE_TOKEN = sanitized grade_no / name (A-Z0-9, max 24)
 *   SEQ4 = first 4 chars of sha256(source_key || id) for collision safety
 *
 * Old SO- codes preserved as `legacyCode` / alias references in the report.
 * Existing grade UUIDs and FKs are never changed in this dry-run.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/dry-run-grade-code-migration.mjs
 *   npm run catalogue:grade-code-dry-run
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'tmp/phase2-grade-code-migration');

function token(value, max = 24) {
  const t = String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max);
  return t || 'NA';
}

function proposePolyStoreXCode(grade) {
  const family = token(
    grade.grade_group || grade.category_code || 'GEN',
    12,
  );
  const gradeToken = token(grade.grade_no || grade.name || grade.code, 24);
  const seed = grade.source_key || grade.id;
  const seq = createHash('sha256').update(seed).digest('hex').slice(0, 4).toUpperCase();
  return `PSX-${family}-${gradeToken}-${seq}`;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (read-only dry-run).');
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
    const { rows: grades } = await client.query(`
      SELECT g.id, g.code, g.name, g.grade_no, g.grade_group, g.source_key,
             g.customer_visible, g.status, c.code AS category_code
      FROM grades g
      LEFT JOIN grade_categories c ON c.id = g.category_id
      WHERE g.deleted_at IS NULL
      ORDER BY g.code
    `);

    const proposed = [];
    const collisions = new Map();
    for (const grade of grades) {
      const next = proposePolyStoreXCode(grade);
      if (!collisions.has(next)) collisions.set(next, []);
      collisions.get(next).push(grade.id);
      proposed.push({
        gradeId: grade.id,
        currentCode: grade.code,
        proposedCode: next,
        legacyAlias: grade.code,
        sourceKey: grade.source_key,
        status: grade.status,
        customerVisible: grade.customer_visible,
        action: 'DRY_RUN_ONLY',
      });
    }

    const collisionRows = [...collisions.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([code, ids]) => ({ proposedCode: code, gradeIds: ids }));

    // Uniqueness after proposal
    const uniqueProposed = new Set(proposed.map((p) => p.proposedCode));

    const summary = {
      generatedAt: new Date().toISOString(),
      mode: 'dry-run',
      productionApply: 'BLOCKED_PENDING_CLIENT_APPROVAL',
      proposedFormat:
        'PSX-{FAMILY}-{GRADE_TOKEN}-{SEQ4} — deterministic; preserves UUID FKs; keeps SO- as legacyAlias',
      explicitlyNot: 'Do not simply replace SO- with PS-',
      totals: {
        gradesScanned: grades.length,
        soPrefixed: grades.filter((g) => String(g.code || '').startsWith('SO-'))
          .length,
        proposedUniqueCodes: uniqueProposed.size,
        collisionGroups: collisionRows.length,
      },
      schemaRecommendation: {
        keepGradeId: true,
        addColumnsOrTable: [
          'grades.legacy_code (nullable text) OR grade_code_aliases(grade_id, code, source)',
          'backfill legacy_code = current code before rewrite',
          'dual-read period: accept lookups by code OR legacy_code',
        ],
      },
      sample: proposed.filter((p) => String(p.currentCode || '').startsWith('SO-')).slice(0, 20),
      notes: [
        'No database writes were performed.',
        'Client must approve format before any production migration.',
        'Collision groups must be resolved (extend SEQ) before apply.',
      ],
    };

    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    writeFileSync(
      join(outDir, 'proposed-mapping.json'),
      JSON.stringify(proposed, null, 2),
    );
    writeFileSync(
      join(outDir, 'collisions.json'),
      JSON.stringify(collisionRows, null, 2),
    );

    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nWrote grade-code dry-run to ${outDir}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
