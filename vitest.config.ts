import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

process.env.NODE_ENV ??= 'test';
process.env.APP_NAME ??= 'swaroop-backend';
process.env.PORT ??= '3000';
process.env.API_PREFIX ??= 'api';
process.env.API_VERSION ??= '1';
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5433/swaroop_test?schema=public';
process.env.JWT_SECRET ??= 'test-jwt-secret-with-sufficient-length-123';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-with-sufficient-length';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-with-sufficient-length';
process.env.JWT_ACCESS_EXPIRES_IN ??= '15m';
process.env.JWT_REFRESH_EXPIRES_IN ??= '30d';
process.env.JWT_EXPIRES_IN ??= '15m';
process.env.CORS_ORIGINS ??= 'http://localhost:3000';
process.env.LOG_LEVEL ??= 'silent';
process.env.SKIP_DB_CONNECT_ON_BOOT ??= 'true';
process.env.AUTH_DEV_EXPOSE_OTP ??= 'true';
process.env.OTP_RESEND_COOLDOWN_SECONDS ??= '1';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    environment: 'node',
  },
});
