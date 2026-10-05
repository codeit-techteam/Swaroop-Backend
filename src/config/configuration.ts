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
  maps: {
    /** Server-only Google Maps Platform key (IP-restricted). Empty disables Google lookups. */
    serverApiKey: string;
    requestTimeoutMs: number;
    /** ISO 3166-1 alpha-2 region used to restrict autocomplete results. */
    regionCode: string;
  };
  import: {
    /** IMPORT_FEATURE_ENABLED — hides every user-facing Import route when false. */
    enabled: boolean;
    /** Background expiry / near-expiry sweep cadence. */
    sweepIntervalMs: number;
    /** IMPORT_MASTER_DATA_AUTO_SEED — insert missing reference data on startup. */
    autoSeedMasterData: boolean;
  };
  gradeMaster: {
    /** GRADE_MASTER_BUNDLED_IMPORT — import the bundled Source.One CSV once per file version. */
    bundledImport: boolean;
  };
  kyc: {
    surepass: SurepassConfig;
    pan: KycProviderConfig;
    gst: KycProviderConfig;
    requestTimeoutMs: number;
    /** Verification attempts allowed per user and identifier type per hour. */
    verifyAttemptsPerHour: number;
    /** KYC document upload sessions allowed per user per hour. */
    uploadsPerHour: number;
    /** When true, ordering / purchase-request APIs reject customers without approved KYC. */
    enforceForTrading: boolean;
  };
};

export type KycProviderConfig = {
  /** Provider label stored on each verification row (e.g. "surepass"). */
  name: string;
  url: string;
  apiKey: string;
  clientId: string;
};

/** Surepass KYC API. Takes precedence over the generic PAN_/GST_ HTTP adapters when the token and base URL are set. */
export type SurepassConfig = {
  baseUrl: string;
  token: string;
  environment: 'production' | 'sandbox';
  panPath: string;
  gstPath: string;
};

/** Surepass KYC docs: PAN Verify and Corporate GSTIN endpoint paths. */
export const SUREPASS_DEFAULT_PAN_PATH = '/api/v1/pan/pan-verify';
export const SUREPASS_DEFAULT_GST_PATH = '/api/v1/corporate/gstin';

const surepassConfig = (): SurepassConfig => ({
  baseUrl: (process.env.SUREPASS_API_BASE_URL ?? '').trim().replace(/\/+$/, ''),
  token: (process.env.SUREPASS_API_TOKEN ?? '').trim(),
  environment:
    (process.env.SUREPASS_ENVIRONMENT ?? '').trim().toLowerCase() === 'sandbox'
      ? 'sandbox'
      : 'production',
  panPath: (process.env.SUREPASS_PAN_PATH || SUREPASS_DEFAULT_PAN_PATH).trim(),
  gstPath: (process.env.SUREPASS_GST_PATH || SUREPASS_DEFAULT_GST_PATH).trim(),
});

const kycProvider = (prefix: 'PAN' | 'GST'): AppConfig['kyc']['pan'] => ({
  name: (process.env[`${prefix}_VERIFICATION_PROVIDER`] || 'http').trim(),
  url: (process.env[`${prefix}_VERIFICATION_API_URL`] ?? '').trim(),
  apiKey: (process.env[`${prefix}_VERIFICATION_API_KEY`] ?? '').trim(),
  clientId: (process.env[`${prefix}_VERIFICATION_CLIENT_ID`] ?? '').trim(),
});

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
      // Demo phone +918240890242 / OTP 123456. On by default for current go-live
      // testing; set AUTH_DEV_FIXED_OTP=false to disable in real production.
      authDevFixedOtp: process.env.AUTH_DEV_FIXED_OTP !== 'false',
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
    maps: {
      serverApiKey: (process.env.GOOGLE_MAPS_SERVER_API_KEY ?? '').trim(),
      requestTimeoutMs: Number(process.env.GOOGLE_MAPS_TIMEOUT_MS || 6000),
      regionCode: (process.env.GOOGLE_MAPS_REGION_CODE || 'IN').toUpperCase(),
    },
    import: {
      enabled: !['false', '0', 'no', 'off'].includes(
        (process.env.IMPORT_FEATURE_ENABLED ?? 'true').trim().toLowerCase(),
      ),
      sweepIntervalMs: Number(
        process.env.IMPORT_EXPIRY_SWEEP_INTERVAL_MS || 60_000,
      ),
      autoSeedMasterData: !['false', '0', 'no', 'off'].includes(
        (process.env.IMPORT_MASTER_DATA_AUTO_SEED ?? 'true')
          .trim()
          .toLowerCase(),
      ),
    },
    gradeMaster: {
      bundledImport: !['false', '0', 'no', 'off'].includes(
        (process.env.GRADE_MASTER_BUNDLED_IMPORT ?? 'true')
          .trim()
          .toLowerCase(),
      ),
    },
    kyc: {
      surepass: surepassConfig(),
      pan: kycProvider('PAN'),
      gst: kycProvider('GST'),
      requestTimeoutMs: Number(
        process.env.KYC_VERIFICATION_TIMEOUT_MS || 10_000,
      ),
      verifyAttemptsPerHour: Number(
        process.env.KYC_VERIFY_ATTEMPTS_PER_HOUR || 10,
      ),
      uploadsPerHour: Number(process.env.KYC_UPLOADS_PER_HOUR || 30),
      enforceForTrading: ['true', '1', 'yes', 'on'].includes(
        (process.env.KYC_ENFORCE_FOR_TRADING ?? 'false').trim().toLowerCase(),
      ),
    },
  };
};
