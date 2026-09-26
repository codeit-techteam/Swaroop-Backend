import type { EnvConfig } from './env.validation.js';

export type AppConfig = {
  app: {
    name: string;
    env: EnvConfig['NODE_ENV'];
    port: number;
    apiPrefix: string;
    apiVersion: string;
    logLevel: EnvConfig['LOG_LEVEL'];
    corsOrigins: string[];
    skipDbConnectOnBoot: boolean;
  };
  database: {
    url: string;
  };
  security: {
    jwtAccessSecret: string;
    jwtRefreshSecret: string;
    jwtAccessExpiresIn: string;
    jwtRefreshExpiresIn: string;
    /** @deprecated use jwtAccessSecret */
    jwtSecret: string;
    /** @deprecated use jwtAccessExpiresIn */
    jwtExpiresIn: string;
    throttleTtlMs: number;
    throttleLimit: number;
    otpLength: number;
    otpExpiresInSeconds: number;
    otpMaxAttempts: number;
    otpResendCooldownSeconds: number;
    authDevExposeOtp: boolean;
    /** When true (or non-production), demo phone +918240890242 always uses OTP 123456. */
    authDevFixedOtp: boolean;
    passwordResetExpiresInSeconds: number;
    bcryptSaltRounds: number;
  };
  storage: {
    provider: 'none' | 'r2';
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
    publicUrl: string;
    endpoint: string;
    region: string;
    signedUrlExpirySeconds: number;
    maxDocumentSizeMb: number;
  };
};

const splitOrigins = (value: string): string[] =>
  value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

/**
 * Central configuration factory used by Nest ConfigModule.
 * Prefer ConfigService.get('...') over process.env in application code.
 */
export default (): AppConfig => {
  const accountId =
    process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID || '';
  const accessKeyId =
    process.env.R2_ACCESS_KEY_ID ||
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ||
    '';
  const secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY ||
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ||
    '';
  const bucketName =
    process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_R2_BUCKET_NAME || '';
  const publicUrl =
    process.env.R2_PUBLIC_BASE_URL ||
    process.env.CLOUDFLARE_R2_PUBLIC_URL ||
    '';
  const storageProviderRaw = (
    process.env.STORAGE_PROVIDER || 'none'
  ).toLowerCase();
  const storageProvider: 'none' | 'r2' =
    storageProviderRaw === 'r2' ? 'r2' : 'none';
  const legacyJwt = process.env.JWT_SECRET ?? '';
  const accessSecret = process.env.JWT_ACCESS_SECRET || legacyJwt;
  const refreshSecret = process.env.JWT_REFRESH_SECRET || legacyJwt;
  const accessExpires =
    process.env.JWT_ACCESS_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '15m';

  return {
    app: {
      name: process.env.APP_NAME ?? 'swaroop-backend',
      env: (process.env.NODE_ENV as AppConfig['app']['env']) ?? 'development',
      port: Number(process.env.PORT ?? 3000),
      apiPrefix: process.env.API_PREFIX ?? 'api',
      apiVersion: process.env.API_VERSION ?? '1',
      logLevel:
        (process.env.LOG_LEVEL as AppConfig['app']['logLevel']) ?? 'info',
      corsOrigins: splitOrigins(
        process.env.CORS_ORIGINS ??
          'http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:4000,http://localhost:5173,http://localhost:8081',
      ),
      skipDbConnectOnBoot:
        process.env.SKIP_DB_CONNECT_ON_BOOT === 'true' ||
        process.env.NODE_ENV === 'test',
    },
    database: {
      url: process.env.DATABASE_URL ?? '',
    },
    security: {
      jwtAccessSecret: accessSecret,
      jwtRefreshSecret: refreshSecret,
      jwtAccessExpiresIn: accessExpires,
      jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
      jwtSecret: accessSecret,
      jwtExpiresIn: accessExpires,
      throttleTtlMs: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
      throttleLimit: Number(process.env.THROTTLE_LIMIT ?? 100),
      otpLength: Number(process.env.OTP_LENGTH ?? 6),
      otpExpiresInSeconds: Number(process.env.OTP_EXPIRES_IN_SECONDS ?? 300),
      otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
      otpResendCooldownSeconds: Number(
        process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 60,
      ),
      authDevExposeOtp: process.env.AUTH_DEV_EXPOSE_OTP === 'true',
      authDevFixedOtp:
        process.env.AUTH_DEV_FIXED_OTP === 'true' ||
        (process.env.NODE_ENV !== 'production' &&
          process.env.AUTH_DEV_FIXED_OTP !== 'false'),
      passwordResetExpiresInSeconds: Number(
        process.env.PASSWORD_RESET_EXPIRES_IN_SECONDS ?? 1800,
      ),
      bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS ?? 12),
    },
    storage: {
      provider: storageProvider,
      accountId,
      accessKeyId,
      secretAccessKey,
      bucketName,
      publicUrl,
      endpoint: accountId
        ? `https://${accountId}.r2.cloudflarestorage.com`
        : '',
      region: process.env.R2_REGION || 'auto',
      signedUrlExpirySeconds: Number(process.env.R2_SIGNED_URL_EXPIRY || 900),
      maxDocumentSizeMb: Number(process.env.MAX_DOCUMENT_SIZE_MB || 10),
    },
  };
};
