import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../config/configuration.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly configService: ConfigService) {
    const databaseUrl = configService.get<AppConfig['database']['url']>(
      'database.url',
      { infer: true },
    );

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not configured');
    }

    const adapter = new PrismaPg({ connectionString: databaseUrl });
    super({ adapter });
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
    this.logger.log('PostgreSQL connection closed');
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
