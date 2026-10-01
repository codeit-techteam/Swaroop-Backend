import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedImportMasterData } from '../prisma/seed/import-master-data.js';

/**
 * Seeds only Import reference data. Safe for production: no users, no demo
 * listings, and existing Admin edits/deactivations are preserved.
 *   npm run import:seed-master
 */
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

seedImportMasterData(prisma)
  .then((counts) => console.log('Import master data seeded', counts))
  .catch((error) => {
    console.error('Import master data seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
