import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

describe('HealthService', () => {
  it('returns ok when database is connected', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) => {
              if (key === 'app.name') return 'swaroop-backend';
              if (key === 'app.skipDbConnectOnBoot') return false;
              return undefined;
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            isHealthy: vi.fn().mockResolvedValue(true),
          },
        },
        {
          provide: StorageService,
          useValue: {
            isConfigured: vi.fn().mockReturnValue(false),
          },
        },
      ],
    }).compile();

    const service = moduleRef.get(HealthService);
    const result = await service.check();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('swaroop-backend');
    expect(result.database).toBe('connected');
    expect(result.storage).toBe('not_configured');
  });
});
