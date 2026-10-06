import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { importSourceOneGrades } from '../src/modules/grades/source-one/source-one-importer.js';
import { BUNDLED_SOURCE_ONE_CSV } from '../src/modules/grades/source-one/source-one-files.js';

/**
 * Imports the Source.One grade master CSV into PostgreSQL.
 *   npm run import:grades                       # bundled CSV
 *   npm run import:grades -- --file ./grades.csv
 *   npm run import:grades -- --dry-run          # validate + diff only
 */
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fileArg = args[args.indexOf('--file') + 1];
const filePath =
  args.includes('--file') && fileArg
    ? fileArg
    : join(process.cwd(), BUNDLED_SOURCE_ONE_CSV);

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
  max: 3,
  ...(relaxedSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log(`Grade import started${dryRun ? ' (dry run)' : ''}...`);
  const summary = await importSourceOneGrades(prisma, {
    csv: readFileSync(filePath, 'utf8'),
    fileName: basename(filePath),
    trigger: 'CLI',
    dryRun,
  });
  console.log(`
File: ${summary.fileName} (sha256 ${summary.fileSha256.slice(0, 12)}…)
Total rows: ${summary.totalRows}
Valid rows: ${summary.validRows}
Invalid: ${summary.invalidRows}
Duplicates handled: ${summary.duplicateRows} (exact copies: ${summary.exactDuplicateRows}, same grade key merged: ${summary.keyMergedRows})
Grades in file: ${summary.grades}
Inserted: ${summary.inserted}
Updated: ${summary.updated}
Unchanged: ${summary.unchanged}
Skipped: ${summary.skipped}
Categories created: ${summary.categoriesCreated}
Grade groups created: ${summary.gradeGroupsCreated}
Source.One grades not in this file: ${summary.notInFile}
${summary.batchId ? `Import batch: ${summary.batchId}\n` : ''}
${dryRun ? 'Dry run completed. No data was written.' : 'Import completed successfully.'}`);
}

main()
  .catch((error) => {
    console.error(
      'Grade import failed:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
