import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { importTdsLibrary } from '../src/modules/tds/tds-importer.js';

/**
 * Bulk-import Polystore TDS Excel + ZIP libraries into R2 + grade_tds_documents.
 *
 *   npm run import:tds -- --dry-run
 *   npm run import:tds
 *   npm run import:tds -- --excel ./path.xlsx --zip ./a.zip --zip ./b.zip
 *   npm run import:tds -- --limit 5
 */
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit =
  limitIdx >= 0 && args[limitIdx + 1]
    ? Number(args[limitIdx + 1])
    : undefined;

function collectFlag(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && args[i + 1]) out.push(resolve(args[++i]!));
  }
  return out;
}

const defaultDir = join(process.cwd(), 'scripts/tds-source');
const excelPath =
  collectFlag('--excel')[0] ??
  join(defaultDir, 'Polystore_TDS_Index.xlsx');
const zipPaths = (() => {
  const z = collectFlag('--zip');
  if (z.length) return z;
  return [
    join(defaultDir, 'Polystore_TDS_Library_Part1.zip'),
    join(defaultDir, 'Polystore_TDS_Library_Part2.zip'),
  ];
})();

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/swaroop?schema=public';
const relaxedSsl =
  /ondigitalocean\.com/i.test(connectionString) ||
  /[?&]sslmode=/i.test(connectionString);
const pool = new Pool({
  connectionString: connectionString
    .replace(
      /([?&])(sslmode|ssl|sslrootcert|sslcert|sslkey|sslpassword|uselibpqcompat)=[^&]*/gi,
      '$1',
    )
    .replace(/[?&]$/, ''),
  max: 5,
  ...(relaxedSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log(
    `TDS library import${dryRun ? ' (DRY RUN)' : ''}…\nExcel: ${excelPath}\nZIPs:\n  - ${zipPaths.join('\n  - ')}`,
  );

  const report = await importTdsLibrary(prisma, {
    excelPath,
    zipPaths,
    dryRun,
    trigger: 'CLI',
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  const outPath = join(
    process.cwd(),
    `tds-import-report-${dryRun ? 'dryrun' : 'live'}-${Date.now()}.json`,
  );
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        ...report,
        rows: report.rows.slice(0, 500),
        rowCount: report.rows.length,
      },
      null,
      2,
    ),
  );

  console.log(`
Batch: ${report.batchId ?? '(dry-run)'}
Excel: Index=${report.excelRows.index} Missing=${report.excelRows.missing} Catalogue=${report.excelRows.catalogue}
ZIP files: ${report.zipFiles}
Exact file matches: ${report.exactFileMatches}
Missing files: ${report.missingFiles}
Unmatched archive files: ${report.unmatchedArchiveFiles}
Duplicate checksums: ${report.duplicateChecksums}
Ambiguous mappings: ${report.ambiguousMappings}
Unmatched grades: ${report.unmatchedGrades}
Uploaded: ${report.uploaded}
Skipped existing: ${report.skippedExisting}
Missing records: ${report.missingRecords}
Failed: ${report.failed}
Report written: ${outPath}
${dryRun ? 'Dry run completed — no DB/R2 writes.' : 'Import completed.'}
`);
}

main()
  .catch((error) => {
    console.error(
      'TDS import failed:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
