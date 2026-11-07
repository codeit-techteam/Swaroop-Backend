import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import type { AppConfig, SurepassConfig } from '../config/configuration.js';
import { StorageService } from '../storage/storage.service.js';

export type OtpHealthStatus = {
  provider: 'msg91' | 'local' | 'none';
  /** True when OTP_PROVIDER=msg91 and auth key + template id are present. */
  msg91Configured: boolean;
  authStrictOtp: boolean;
  templateConfigured: boolean;
  /** True only when MSG91_SENDER_ID is explicitly set (optional override). */
  senderIdConfigured: boolean;
  /** DLT header documentation value present (not sent unless SENDER_ID set). */
  headerConfigured: boolean;
};

export type HealthStatus = {
  status: 'ok' | 'degraded';
  service: string;
  database: 'connected' | 'disconnected' | 'skipped';
  storage: 'configured' | 'not_configured';
  surepass: 'configured' | 'not_configured';
  otp: OtpHealthStatus;
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

    const surepassSettings =
      this.configService.get<SurepassConfig>('kyc.surepass');
    const surepass =
      surepassSettings?.baseUrl && surepassSettings.token
        ? 'configured'
        : 'not_configured';

    const providerRaw = (
      this.configService.get<string>('otp.provider') ?? 'local'
    ).toLowerCase();
    const provider: OtpHealthStatus['provider'] =
      providerRaw === 'msg91'
        ? 'msg91'
        : providerRaw === 'none'
          ? 'none'
          : 'local';
    const authKey = (
      this.configService.get<string>('otp.msg91.authKey') ?? ''
    ).trim();
    const templateId = (
      this.configService.get<string>('otp.msg91.templateId') ?? ''
    ).trim();
    const senderId = (
      this.configService.get<string>('otp.msg91.senderId') ?? ''
    ).trim();
    const header = (
      this.configService.get<string>('otp.msg91.header') ?? ''
    ).trim();
    const msg91Configured =
      provider === 'msg91' && authKey.length > 0 && templateId.length > 0;

    const otp: OtpHealthStatus = {
      provider,
      msg91Configured,
      authStrictOtp:
        this.configService.get<boolean>('security.authStrictOtp') === true,
      templateConfigured: templateId.length > 0,
      senderIdConfigured: senderId.length > 0,
      headerConfigured: header.length > 0,
    };

    const status: HealthStatus['status'] =
      database === 'disconnected' ||
      (provider === 'msg91' && !msg91Configured)
        ? 'degraded'
        : 'ok';

    return {
      status,
      service,
      database,
      storage,
      surepass,
      otp,
      timestamp: new Date().toISOString(),
    };
  }
}
