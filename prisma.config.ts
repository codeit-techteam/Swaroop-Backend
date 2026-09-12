import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (Prisma ORM v7).
 * Runtime app code reads DATABASE_URL via Nest ConfigModule.
 * Compatible with DigitalOcean Managed PostgreSQL and Azure Database for PostgreSQL
 * through DATABASE_URL only — no provider-specific application logic.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5433/swaroop?schema=public',
  },
});
