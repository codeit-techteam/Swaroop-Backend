import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import type { AppConfig } from '../config/configuration.js';
import { StorageService } from '../storage/storage.service.js';

export type HealthStatus = {
  status: 'ok' | 'degraded';
  service: string;
  database: 'connected' | 'disconnected' | 'skipped';
  storage: 'configured' | 'not_configured';
  timestamp: string;
};

@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async check(): Promise<HealthStatus> {
    const service =
      this.configService.get<AppConfig['app']['name']>('app.name', {
        infer: true,
      }) ?? 'swaroop-backend';

    const skipDb = this.configService.get<boolean>('app.skipDbConnectOnBoot', {
      infer: true,
    });

    let database: HealthStatus['database'];

    if (skipDb) {
      database = 'skipped';
    } else {
      database = (await this.prisma.isHealthy()) ? 'connected' : 'disconnected';
    }

    const storage = this.storageService.isConfigured()
      ? 'configured'
      : 'not_configured';

    const status: HealthStatus['status'] =
      database === 'disconnected' ? 'degraded' : 'ok';

    return {
      status,
      service,
      database,
      storage,
      timestamp: new Date().toISOString(),
    };
  }
}
