import { z } from 'zod';

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') {
      return value;
    }
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  });

export const envSchema = z
  .object({
    APP_NAME: z.string().min(1).default('swaroop-backend'),
    NODE_ENV: z
      .enum(['development', 'test', 'staging', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    API_PREFIX: z.string().min(1).default('api'),
    API_VERSION: z.string().min(1).default('1'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // Legacy single secret kept for backward compatibility; access secret preferred.
    JWT_SECRET: z.string().min(1).optional(),
    JWT_EXPIRES_IN: z.string().min(1).optional(),
    JWT_ACCESS_SECRET: z.string().min(1).optional(),
    JWT_REFRESH_SECRET: z.string().min(1).optional(),
    JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('30d'),

    CORS_ORIGINS: z.string().min(1).default('http://localhost:3000'),

    STORAGE_PROVIDER: z.enum(['none', 'r2']).default('none'),
    MAX_DOCUMENT_SIZE_MB: z.coerce.number().int().positive().default(10),

    // Preferred short names (Phase docs)
    R2_ACCOUNT_ID: z.string().optional().default(''),
    R2_ACCESS_KEY_ID: z.string().optional().default(''),
    R2_SECRET_ACCESS_KEY: z.string().optional().default(''),
    R2_BUCKET_NAME: z.string().optional().default(''),
    R2_PUBLIC_BASE_URL: z.string().optional().default(''),
    R2_REGION: z.string().optional().default('auto'),
    R2_SIGNED_URL_EXPIRY: z.coerce.number().int().positive().default(900),

    // Legacy Cloudflare-prefixed aliases
    CLOUDFLARE_R2_ACCOUNT_ID: z.string().optional().default(''),
    CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().optional().default(''),
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().optional().default(''),
    CLOUDFLARE_R2_BUCKET_NAME: z.string().optional().default(''),
    CLOUDFLARE_R2_PUBLIC_URL: z.string().optional().default(''),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),

    OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    OTP_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
    AUTH_DEV_EXPOSE_OTP: booleanFromString.optional().default(false),
    PASSWORD_RESET_EXPIRES_IN_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(1800),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    SKIP_DB_CONNECT_ON_BOOT: booleanFromString.optional().default(false),

    GOOGLE_MAPS_SERVER_API_KEY: z.string().optional().default(''),
    GOOGLE_MAPS_TIMEOUT_MS: z.coerce.number().int().positive().default(6000),
    GOOGLE_MAPS_REGION_CODE: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .optional()
      .default('IN'),

    IMPORT_FEATURE_ENABLED: booleanFromString.optional().default(true),
    IMPORT_EXPIRY_SWEEP_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(5_000)
      .default(60_000),

    SUREPASS_API_BASE_URL: z.url().optional().or(z.literal('')).default(''),
    SUREPASS_API_TOKEN: z.string().optional().default(''),
    SUREPASS_ENVIRONMENT: z
      .enum(['production', 'sandbox'])
      .optional()
      .or(z.literal(''))
      .default(''),
    SUREPASS_PAN_PATH: z
      .string()
      .regex(/^\/[A-Za-z0-9/_-]*$/, 'must be a path such as /pan/pan')
      .optional()
      .or(z.literal(''))
      .default(''),
    SUREPASS_GST_PATH: z
      .string()
      .regex(/^\/[A-Za-z0-9/_-]*$/, 'must be a path such as /corporate/gstin')
      .optional()
      .or(z.literal(''))
      .default(''),
    PAN_VERIFICATION_PROVIDER: z.string().optional().default('http'),
    PAN_VERIFICATION_API_URL: z.url().optional().or(z.literal('')).default(''),
    PAN_VERIFICATION_API_KEY: z.string().optional().default(''),
    PAN_VERIFICATION_CLIENT_ID: z.string().optional().default(''),
    GST_VERIFICATION_PROVIDER: z.string().optional().default('http'),
    GST_VERIFICATION_API_URL: z.url().optional().or(z.literal('')).default(''),
    GST_VERIFICATION_API_KEY: z.string().optional().default(''),
    GST_VERIFICATION_CLIENT_ID: z.string().optional().default(''),
    KYC_VERIFICATION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(60_000)
      .default(10_000),
    KYC_VERIFY_ATTEMPTS_PER_HOUR: z.coerce
      .number()
      .int()
      .positive()
      .default(10),
    KYC_UPLOADS_PER_HOUR: z.coerce.number().int().positive().default(30),
    KYC_ENFORCE_FOR_TRADING: booleanFromString.optional().default(false),
  })
  .superRefine((data, ctx) => {
    const accessSecret = data.JWT_ACCESS_SECRET || data.JWT_SECRET;
    const refreshSecret = data.JWT_REFRESH_SECRET || data.JWT_SECRET;

    if (!accessSecret) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'JWT_ACCESS_SECRET or JWT_SECRET is required',
      });
    }

    if (!refreshSecret) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET or JWT_SECRET is required',
      });
    }

    if (
      Boolean(data.SUREPASS_API_BASE_URL) !== Boolean(data.SUREPASS_API_TOKEN)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: [
          data.SUREPASS_API_BASE_URL
            ? 'SUREPASS_API_TOKEN'
            : 'SUREPASS_API_BASE_URL',
        ],
        message:
          'SUREPASS_API_BASE_URL and SUREPASS_API_TOKEN must be set together',
      });
    }
    if (
      data.SUREPASS_API_BASE_URL &&
      !data.SUREPASS_API_BASE_URL.startsWith('https://')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['SUREPASS_API_BASE_URL'],
        message: 'SUREPASS_API_BASE_URL must use https',
      });
    }

    if (data.NODE_ENV === 'production') {
      const requiredInProduction: Array<keyof typeof data> = [
        'DATABASE_URL',
        'CORS_ORIGINS',
      ];

      for (const key of requiredInProduction) {
        const value = data[key];
        if (typeof value === 'string' && value.trim().length === 0) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required in production`,
          });
        }
      }

      // R2 credentials are required only when storage provider is r2
      if (data.STORAGE_PROVIDER === 'r2') {
        const accountId = data.R2_ACCOUNT_ID || data.CLOUDFLARE_R2_ACCOUNT_ID;
        const accessKey =
          data.R2_ACCESS_KEY_ID || data.CLOUDFLARE_R2_ACCESS_KEY_ID;
        const secret =
          data.R2_SECRET_ACCESS_KEY || data.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
        const bucket = data.R2_BUCKET_NAME || data.CLOUDFLARE_R2_BUCKET_NAME;
        for (const [label, value] of [
          ['R2_ACCOUNT_ID', accountId],
          ['R2_ACCESS_KEY_ID', accessKey],
          ['R2_SECRET_ACCESS_KEY', secret],
          ['R2_BUCKET_NAME', bucket],
        ] as const) {
          if (!value || value.trim().length === 0) {
            ctx.addIssue({
              code: 'custom',
              path: [label],
              message: `${label} is required when STORAGE_PROVIDER=r2 in production`,
            });
          }
        }
      }

      for (const [label, secret] of [
        ['JWT_ACCESS_SECRET', accessSecret],
        ['JWT_REFRESH_SECRET', refreshSecret],
      ] as const) {
        if (
          typeof secret === 'string' &&
          (secret.includes('change-me') || secret.length < 32)
        ) {
          ctx.addIssue({
            code: 'custom',
            path: [label],
            message: `${label} must be a strong secret (min 32 chars) in production`,
          });
        }
      }

      if (data.AUTH_DEV_EXPOSE_OTP) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_DEV_EXPOSE_OTP'],
          message: 'AUTH_DEV_EXPOSE_OTP must be false in production',
        });
      }
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Environment validation failed: ${details}`);
  }

  return parsed.data;
}
