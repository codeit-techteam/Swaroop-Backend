#!/usr/bin/env node
/**
 * Unlink the confirmed wrong TDS from ABS EXTRUSION 3000D.
 *
 * Matches only rows whose filename is ABS_EXTRUSION_SR101_TDS.pdf AND whose
 * linked grade is 3000D (not the SR101 grade). The document row is kept.
 * grade_id is cleared, is_active is set false, and verification_status
 * becomes REJECTED so it cannot be served as that grade's TDS.
 *
 * Dry-run unless --apply is passed. A JSON backup of matched rows is written
 * before any update.
 *
 *   node scripts/unlink-wrong-abs-3000d-tds.mjs
 *   node scripts/unlink-wrong-abs-3000d-tds.mjs --apply
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes('--apply');
const outDir = join(__dirname, '..', 'tmp/tds-unlink');

const sql = `
  SELECT d.id, d.grade_id, d.grade_code, d.original_filename, d.document_title,
         d.verification_status, d.is_active, d.producer_name, d.storage_key,
         g.code AS linked_grade_code, g.name AS linked_grade_name,
         g.grade_no, g.full_grade_name, g.manufacturer
  FROM grade_tds_documents d
  LEFT JOIN grades g ON g.id = d.grade_id
  WHERE d.deleted_at IS NULL
    AND lower(d.original_filename) = 'abs_extrusion_sr101_tds.pdf'
    AND (
      coalesce(g.grade_no, '') ILIKE '%3000D%'
      OR coalesce(g.name, '') ILIKE '%3000D%'
      OR coalesce(g.full_grade_name, '') ILIKE '%3000D%'
      OR coalesce(g.code, '') ILIKE '%3000D%'
      OR coalesce(d.grade_code, '') ILIKE '%3000D%'
    )
    AND coalesce(g.grade_no, '') NOT ILIKE '%SR101%'
    AND coalesce(g.name, '') NOT ILIKE '%SR101%'
`;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: /sslmode=require|ondigitalocean|ssl=true/i.test(databaseUrl)
      ? { rejectUnauthorized: false }
      : undefined,
  });
  await client.connect();
  mkdirSync(outDir, { recursive: true });
  try {
    const { rows } = await client.query(sql);
    const backup = join(
      outDir,
      `abs-3000d-sr101-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    writeFileSync(
      backup,
      JSON.stringify({ matched: rows.length, rows }, null, 2),
    );
    console.log(`matched=${rows.length}`);
    for (const row of rows) {
      console.log(
        [
          row.id,
          row.original_filename,
          row.linked_grade_code,
          row.linked_grade_name,
          row.grade_no,
          row.verification_status,
          `active=${row.is_active}`,
        ].join(' | '),
      );
    }
    console.log(`backup=${backup}`);
    if (!apply) {
      console.log('dry-run only. Re-run with --apply to unlink these rows.');
      return;
    }
    if (rows.length === 0) {
      console.log('nothing to update');
      return;
    }
    const ids = rows.map((row) => row.id);
    const updated = await client.query(
      `
      UPDATE grade_tds_documents
      SET grade_id = NULL,
          is_active = false,
          verification_status = 'REJECTED',
          review_notes = COALESCE(review_notes, '') ||
            E'\\nUnlinked 2026-11-17: ABS_EXTRUSION_SR101_TDS.pdf is not the TDS for ABS EXTRUSION 3000D. No replacement attached.',
          updated_at = NOW()
      WHERE id = ANY($1::uuid[])
      RETURNING id
      `,
      [ids],
    );
    console.log(`updated=${updated.rowCount}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
