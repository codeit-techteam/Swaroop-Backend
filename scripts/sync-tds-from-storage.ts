import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import type { ConfigService } from '@nestjs/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import configuration from '../src/config/configuration.js';
import { CloudflareR2Provider } from '../src/storage/providers/cloudflare-r2.provider.js';
import { NoopStorageProvider } from '../src/storage/providers/noop-storage.provider.js';
import { StorageService } from '../src/storage/storage.service.js';
import { GradeTdsService } from '../src/modules/tds/grade-tds.service.js';
import type { NotificationService } from '../src/modules/notifications/notification.service.js';

/**
 * Reconcile R2 `tds/` → grade_tds_documents without HTTP gateway timeouts.
 *
 *   npm run sync:tds-storage
 *   npm run sync:tds-storage -- --limit 100
 *
 * Point DATABASE_URL at production to fix live Customer/Seller "Request TDS".
 */
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit =
  limitIdx >= 0 && args[limitIdx + 1]
    ? Number(args[limitIdx + 1])
    : 100;

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

function makeConfigService(): ConfigService {
  const appConfig = configuration();
  return {
    get: (key: string) =>
      (appConfig as unknown as Record<string, unknown>)[key],
  } as unknown as ConfigService;
}

async function main() {
  const configService = makeConfigService();
  const r2 = new CloudflareR2Provider(configService);
  const noop = new NoopStorageProvider();
  const storage = new StorageService(configService, r2, noop);
  const notifications = {
    create: async () => null,
  } as unknown as NotificationService;
  const tds = new GradeTdsService(prisma, storage, notifications);

  const host =
    (connectionString.match(/@([^:/]+)/) || [])[1] || 'unknown';
  console.log(
    `TDS storage sync → DB host=${host} bucket=${process.env.R2_BUCKET_NAME} chunk=${limit}`,
  );

  if (!storage.isConfigured()) {
    throw new Error('Storage is not configured (set STORAGE_PROVIDER=r2 + R2_*)');
  }

  let continuationToken: string | undefined;
  let chunk = 0;
  const totals = {
    scanned: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    verified: 0,
    needsMapping: 0,
    fulfilledRequests: 0,
  };

  do {
    chunk += 1;
    const result = await tds.adminReconcileFromStorage({
      autoVerify: true,
      limit,
      continuationToken,
    });
    totals.scanned += result.scanned;
    totals.skipped += result.skipped;
    totals.created += result.created;
    totals.updated += result.updated;
    totals.verified += result.verified;
    totals.needsMapping += result.needsMapping;
    totals.fulfilledRequests += result.fulfilledRequests;
    console.log(
      `chunk ${chunk}: scanned=${result.scanned} created=${result.created} updated=${result.updated} verified=${result.verified} done=${result.done}`,
    );
    if (result.sample.length) {
      for (const line of result.sample.slice(0, 3)) console.log(`  · ${line}`);
    }
    continuationToken = result.done
      ? undefined
      : (result.continuationToken ?? undefined);
  } while (continuationToken);

  console.log('Done:', totals);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
