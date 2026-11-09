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
              if (key === 'kyc.surepass') {
                return {
                  baseUrl: 'https://kyc-api.surepass.app',
                  token: 'secret-token',
                };
              }
              if (key === 'otp.provider') return 'msg91';
              if (key === 'otp.msg91.authKey') return 'test-auth-key';
              if (key === 'otp.msg91.templateId') return '6ae081288c342f46e203bb12';
              if (key === 'otp.msg91.senderId') return '';
              if (key === 'otp.msg91.header') return 'VELPLY';
              if (key === 'otp.msg91.dltTemplateId') return '1077252360053463958';
              if (key === 'otp.msg91.dltEntityId') return '1001111222233334444';
              if (key === 'security.authStrictOtp') return true;
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
    expect(result.surepass).toBe('configured');
    expect(result.otp).toEqual({
      provider: 'msg91',
      msg91Configured: true,
      authStrictOtp: true,
      templateConfigured: true,
      senderIdConfigured: false,
      headerConfigured: true,
      dltTemplateConfigured: true,
      dltEntityConfigured: true,
    });
    // Non-production env: missing sender does not degrade health.
    expect(result.status).toBe('ok');
    expect(JSON.stringify(result)).not.toContain('secret-token');
    expect(JSON.stringify(result)).not.toContain('test-auth-key');
  });

  it('degrades production health when MSG91 sender id is missing', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) => {
              if (key === 'app.name') return 'swaroop-backend';
              if (key === 'app.env') return 'production';
              if (key === 'app.skipDbConnectOnBoot') return false;
              if (key === 'kyc.surepass') {
                return { baseUrl: 'https://kyc-api.surepass.app', token: 'x' };
              }
              if (key === 'otp.provider') return 'msg91';
              if (key === 'otp.msg91.authKey') return 'test-auth-key';
              if (key === 'otp.msg91.templateId') return '6ae081288c342f46e203bb12';
              if (key === 'otp.msg91.senderId') return '';
              if (key === 'otp.msg91.header') return 'VELPLY';
              if (key === 'otp.msg91.dltTemplateId') return '1077252360053463958';
              if (key === 'otp.msg91.dltEntityId') return '1001111222233334444';
              if (key === 'security.authStrictOtp') return true;
              return undefined;
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: { isHealthy: vi.fn().mockResolvedValue(true) },
        },
        {
          provide: StorageService,
          useValue: { isConfigured: vi.fn().mockReturnValue(true) },
        },
      ],
    }).compile();

    const result = await moduleRef.get(HealthService).check();
    expect(result.status).toBe('degraded');
    expect(result.otp.senderIdConfigured).toBe(false);
  });

  it('degrades production health when MSG91_DLT_TEMPLATE_ID is missing', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) => {
              if (key === 'app.name') return 'swaroop-backend';
              if (key === 'app.env') return 'production';
              if (key === 'app.skipDbConnectOnBoot') return false;
              if (key === 'kyc.surepass') {
                return { baseUrl: 'https://kyc-api.surepass.app', token: 'x' };
              }
              if (key === 'otp.provider') return 'msg91';
              if (key === 'otp.msg91.authKey') return 'test-auth-key';
              if (key === 'otp.msg91.templateId') return '6ae081288c342f46e203bb12';
              if (key === 'otp.msg91.senderId') return 'VELPLY';
              if (key === 'otp.msg91.header') return 'VELPLY';
              if (key === 'otp.msg91.dltTemplateId') return '';
              if (key === 'otp.msg91.dltEntityId') return '1001111222233334444';
              if (key === 'security.authStrictOtp') return true;
              return undefined;
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: { isHealthy: vi.fn().mockResolvedValue(true) },
        },
        {
          provide: StorageService,
          useValue: { isConfigured: vi.fn().mockReturnValue(true) },
        },
      ],
    }).compile();

    const result = await moduleRef.get(HealthService).check();
    expect(result.status).toBe('degraded');
    expect(result.otp.dltTemplateConfigured).toBe(false);
  });

  it('degrades production health when MSG91_DLT_ENTITY_ID is missing', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) => {
              if (key === 'app.name') return 'swaroop-backend';
              if (key === 'app.env') return 'production';
              if (key === 'app.skipDbConnectOnBoot') return false;
              if (key === 'kyc.surepass') {
                return { baseUrl: 'https://kyc-api.surepass.app', token: 'x' };
              }
              if (key === 'otp.provider') return 'msg91';
              if (key === 'otp.msg91.authKey') return 'test-auth-key';
              if (key === 'otp.msg91.templateId') return '6ae081288c342f46e203bb12';
              if (key === 'otp.msg91.senderId') return 'VELPLY';
              if (key === 'otp.msg91.header') return 'VELPLY';
              if (key === 'otp.msg91.dltTemplateId') return '1077252360053463958';
              if (key === 'otp.msg91.dltEntityId') return '';
              if (key === 'security.authStrictOtp') return true;
              return undefined;
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: { isHealthy: vi.fn().mockResolvedValue(true) },
        },
        {
          provide: StorageService,
          useValue: { isConfigured: vi.fn().mockReturnValue(true) },
        },
      ],
    }).compile();

    const result = await moduleRef.get(HealthService).check();
    expect(result.status).toBe('degraded');
    expect(result.otp.dltEntityConfigured).toBe(false);
  });
});
