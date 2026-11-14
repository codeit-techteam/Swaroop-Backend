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
    corsAllowPlatformHosts: boolean;
    skipDbConnectOnBoot: boolean;
  };
  /**
   * Browser origins of each first-party client, used to attribute records
   * (e.g. credit application source) server-side. Entries may use a single
   * `*` wildcard in the host, e.g. `https://swaroop-website-*.vercel.app`.
   */
  clientOrigins: {
    website: string[];
    customerWeb: string[];
    sellerWeb: string[];
    adminWeb: string[];
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
    throttleMarketplaceLimit: number;
    otpLength: number;
    otpExpiresInSeconds: number;
    otpMaxAttempts: number;
    otpResendCooldownSeconds: number;
    /** Max OTP sends per identifier+purpose per rolling hour (DB-backed). */
    otpMaxSendsPerHour: number;
    /** Max OTP send/resend requests per client IP per window (in-memory). */
    otpIpMaxRequests: number;
    /** Window for OTP IP rate limit, in seconds. */
    otpIpWindowSeconds: number;
    authDevExposeOtp: boolean;
    /**
     * Demo phone +918240890242 accepts OTP 123456 when explicitly opted in.
     * Off by default; always off when AUTH_STRICT_OTP=true. See `resolveFixedDevOtp`.
     */
    authDevFixedOtp: boolean;
    /**
     * Hard lock for real SMS production. When true, fixed demo OTP is never accepted.
     */
    authStrictOtp: boolean;
    passwordResetExpiresInSeconds: number;
    bcryptSaltRounds: number;
  };
  otp: {
    provider: 'msg91' | 'local' | 'none';
    environment: 'production' | 'development';
    /** When true (production + MSG91 selected), refuse phone OTP without credentials. */
    requireProviderInProduction: boolean;
    msg91: {
      authKey: string;
      templateId: string;
      senderId: string;
      header: string;
      dltEntityId: string;
      dltTemplateId: string;
      timeoutMs: number;
    };
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
  settlements: {
    /** Days after creation before settlementDate (due). */
    cycleDays: number;
    /** Fixed platform fee deducted from seller settlement (configured, default 0). */
    platformFee: string;
    /** TDS rate 0–1 applied to (gross + tax); configured, default 0. */
    tdsRate: string;
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
  /**
   * Public legal / support destinations for login screens. Empty strings mean
   * "not configured" — clients must not invent placeholders.
   */
  legal: {
    websiteUrl: string;
    termsUrl: string;
    privacyUrl: string;
    supportUrl: string;
    supportEmail: string;
    supportPhone: string;
    supportWhatsapp: string;
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

const clientOrigins = (
  envKey: string,
  productionDefaults: string[],
  localDefaults: string[],
): string[] => {
  const configured = process.env[envKey];
  if (configured && configured.trim()) return splitOrigins(configured);
  return process.env.NODE_ENV === 'production'
    ? productionDefaults
    : [...productionDefaults, ...localDefaults];
};

/**
 * Whether the fixed demo OTP (123456 for +918240890242 only) is accepted.
 *
 * Fail-closed / opt-in only:
 * - AUTH_STRICT_OTP=true → always off (production SMS lock)
 * - AUTH_DEV_FIXED_OTP must be explicitly true/1/yes/on to enable
 * - Default when unset → off (never invent a live bypass)
 *
 * Use AUTH_DEV_FIXED_OTP=true only on non-production or temporary staging
 * while MSG91/DLT is being validated. Production must set AUTH_STRICT_OTP=true.
 */
export const resolveFixedDevOtp = (
  env: Record<string, string | undefined>,
): boolean => {
  if ((env.AUTH_STRICT_OTP ?? '').trim().toLowerCase() === 'true') return false;
  const flag = (env.AUTH_DEV_FIXED_OTP ?? '').trim().toLowerCase();
  return flag === 'true' || flag === '1' || flag === 'yes' || flag === 'on';
};

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
      corsAllowPlatformHosts: process.env.CORS_ALLOW_PLATFORM_HOSTS !== 'false',
      skipDbConnectOnBoot:
        process.env.SKIP_DB_CONNECT_ON_BOOT === 'true' ||
        process.env.NODE_ENV === 'test',
    },
    clientOrigins: {
      website: clientOrigins(
        'WEBSITE_ORIGINS',
        [
          'https://swaroop-website.vercel.app',
          'https://swaroop-website-*.vercel.app',
        ],
        ['http://localhost:3004'],
      ),
      customerWeb: clientOrigins(
        'CUSTOMER_WEB_ORIGINS',
        [
          'https://swaroop-customer-webapp.vercel.app',
          'https://swaroop-customer-webapp-*.vercel.app',
        ],
        ['http://localhost:3000', 'http://localhost:3001'],
      ),
      sellerWeb: clientOrigins(
        'SELLER_WEB_ORIGINS',
        [
          'https://swaroop-seller-webapp.vercel.app',
          'https://swaroop-seller-webapp-*.vercel.app',
        ],
        ['http://localhost:3003'],
      ),
      adminWeb: clientOrigins(
        'ADMIN_WEB_ORIGINS',
        [
          'https://swaroop-admin-pi.vercel.app',
          'https://swaroop-admin-*.vercel.app',
        ],
        ['http://localhost:3002'],
      ),
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
      // Catalogue browsing needs headroom; OTP/auth remains on dedicated limiters.
      throttleLimit: Number(process.env.THROTTLE_LIMIT ?? 300),
      throttleMarketplaceLimit: Number(
        process.env.THROTTLE_MARKETPLACE_LIMIT ?? 600,
      ),
      otpLength: Number(process.env.OTP_LENGTH ?? 6),
      otpExpiresInSeconds: Number(process.env.OTP_EXPIRES_IN_SECONDS ?? 600),
      otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
      otpResendCooldownSeconds: Number(
        process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 60,
      ),
      otpMaxSendsPerHour: Number(process.env.OTP_MAX_SENDS_PER_HOUR ?? 5),
      otpIpMaxRequests: Number(process.env.OTP_IP_MAX_REQUESTS ?? 20),
      otpIpWindowSeconds: Number(process.env.OTP_IP_WINDOW_SECONDS ?? 3600),
      authDevExposeOtp: process.env.AUTH_DEV_EXPOSE_OTP === 'true',
      authStrictOtp: process.env.AUTH_STRICT_OTP === 'true',
      authDevFixedOtp: resolveFixedDevOtp(process.env),
      passwordResetExpiresInSeconds: Number(
        process.env.PASSWORD_RESET_EXPIRES_IN_SECONDS ?? 1800,
      ),
      bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS ?? 12),
    },
    otp: (() => {
      const providerRaw = (process.env.OTP_PROVIDER ?? 'local')
        .trim()
        .toLowerCase();
      const provider: 'msg91' | 'local' | 'none' =
        providerRaw === 'msg91'
          ? 'msg91'
          : providerRaw === 'none'
            ? 'none'
            : 'local';
      const otpEnvRaw = (process.env.OTP_ENVIRONMENT ?? process.env.NODE_ENV ?? '')
        .trim()
        .toLowerCase();
      const otpEnvironment: 'production' | 'development' =
        otpEnvRaw === 'production' ? 'production' : 'development';
      return {
        provider,
        environment: otpEnvironment,
        // Fail-closed: in production/staging a real SMS provider is mandatory,
        // regardless of OTP_PROVIDER. Without it phone OTP sends are refused.
        requireProviderInProduction:
          process.env.NODE_ENV === 'production' ||
          process.env.NODE_ENV === 'staging',
        msg91: {
          authKey: (process.env.MSG91_AUTH_KEY ?? '').trim(),
          templateId: (
            process.env.MSG91_OTP_TEMPLATE_ID ??
            process.env.MSG91_TEMPLATE_ID ??
            ''
          ).trim(),
          senderId: (process.env.MSG91_SENDER_ID ?? '').trim(),
          header: (process.env.MSG91_HEADER ?? 'VELPLY').trim(),
          dltEntityId: (process.env.MSG91_DLT_ENTITY_ID ?? '').trim(),
          dltTemplateId: (process.env.MSG91_DLT_TEMPLATE_ID ?? '').trim(),
          timeoutMs: Number(process.env.MSG91_TIMEOUT_MS ?? 15_000),
        },
      };
    })(),
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
    settlements: {
      cycleDays: Number(process.env.SETTLEMENT_CYCLE_DAYS ?? 7),
      platformFee: process.env.SETTLEMENT_PLATFORM_FEE ?? '0',
      tdsRate: process.env.SETTLEMENT_TDS_RATE ?? '0',
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
    legal: (() => {
      const trim = (v: string | undefined) => (v ?? '').trim().replace(/\/+$/, '');
      // Official site. polystorex.com/terms, /privacy and /contact return 200.
      // Older Vercel hosts are rewritten onto this origin.
      const LIVE_WEBSITE_URL = 'https://polystorex.com';
      const BROKEN_WEBSITE_HOSTS = new Set([
        'petrotrade.in',
        'www.petrotrade.in',
        'swaroop-website.vercel.app',
        'swaroop-website-mocha.vercel.app',
      ]);
      const resolveWebsiteOrigin = (raw: string): string => {
        const value = trim(raw);
        if (!value) return '';
        try {
          const parsed = new URL(value);
          if (BROKEN_WEBSITE_HOSTS.has(parsed.hostname.toLowerCase())) {
            return LIVE_WEBSITE_URL;
          }
          return value;
        } catch {
          return value;
        }
      };
      const websiteUrl =
        resolveWebsiteOrigin(process.env.PUBLIC_WEBSITE_URL ?? '') ||
        // First concrete origin from WEBSITE_ORIGINS (skip wildcard preview hosts).
        resolveWebsiteOrigin(
          (
            process.env.WEBSITE_ORIGINS ?? LIVE_WEBSITE_URL
          )
            .split(',')
            .map((o) => o.trim())
            .find((o) => o.startsWith('http') && !o.includes('*')) || '',
        ) ||
        LIVE_WEBSITE_URL;
      const join = (path: string) =>
        websiteUrl ? `${websiteUrl}${path.startsWith('/') ? path : `/${path}`}` : '';
      const resolvePublicPath = (override: string | undefined, path: string) => {
        const configured = trim(override);
        if (!configured) return join(path);
        try {
          const parsed = new URL(configured);
          if (BROKEN_WEBSITE_HOSTS.has(parsed.hostname.toLowerCase())) {
            return join(parsed.pathname || path);
          }
          return configured;
        } catch {
          return configured;
        }
      };
      return {
        websiteUrl,
        termsUrl: resolvePublicPath(process.env.PUBLIC_TERMS_URL, '/terms'),
        privacyUrl: resolvePublicPath(process.env.PUBLIC_PRIVACY_URL, '/privacy'),
        supportUrl: resolvePublicPath(process.env.PUBLIC_SUPPORT_URL, '/contact'),
        // Prefer env; fall back to client-approved contacts (4 Nov 2026).
        supportEmail:
          trim(process.env.PUBLIC_SUPPORT_EMAIL) || 'connect@polystorex.com',
        supportPhone:
          trim(process.env.PUBLIC_SUPPORT_PHONE) || '+91 99626 20101',
        supportWhatsapp:
          trim(process.env.PUBLIC_SUPPORT_WHATSAPP) ||
          'https://wa.me/919962620101',
      };
    })(),
  };
};
