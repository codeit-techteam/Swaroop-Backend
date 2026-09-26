import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../config/configuration.js';

/**
 * Build a pg Pool that works with DigitalOcean Managed Postgres.
 *
 * Node `pg` (v8.16+) treats `sslmode=require` in the URL as verify-full, which
 * rejects DO's chain ("self-signed certificate in certificate chain"). Strip
 * SSL query params and set `rejectUnauthorized: false` explicitly instead.
 */
function createPool(connectionString: string): Pool {
  let normalized = connectionString.trim();
  const hadSslMode = /[?&]sslmode=/i.test(normalized);
  const isManagedHost = /ondigitalocean\.com/i.test(normalized);

  // Remove SSL-related query params so pg-connection-string does not force verify-full.
  normalized = normalized
    .replace(
      /([?&])(sslmode|ssl|sslrootcert|sslcert|sslkey|sslpassword|uselibpqcompat)=[^&]*/gi,
      '$1',
    )
    .replace(/[?&]$/, '')
    .replace(/\?&/, '?')
    .replace(/&&+/g, '&');

  const useSsl = isManagedHost || hadSslMode;

  return new Pool({
    connectionString: normalized,
    max: 10,
    connectionTimeoutMillis: 10_000,
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor(private readonly configService: ConfigService) {
    const databaseUrl = configService.get<AppConfig['database']['url']>(
      'database.url',
      { infer: true },
    );

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not configured');
    }

    const pool = createPool(databaseUrl);
    const adapter = new PrismaPg(pool);
    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit(): Promise<void> {
    const skip = this.configService.get<boolean>('app.skipDbConnectOnBoot', {
      infer: true,
    });

    if (skip) {
      this.logger.warn('Skipping database connection on boot (test mode)');
      return;
    }

    try {
      await this.$connect();
      // Force a real round-trip so TLS/auth failures surface at boot.
      await this.$queryRaw`SELECT 1`;
      this.logger.log('PostgreSQL connection established via Prisma');
    } catch (error) {
      this.logger.error(
        'Failed to connect to PostgreSQL',
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await this.pool.end();
    this.logger.log('PostgreSQL connection closed');
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.warn(
        `Database health check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}
