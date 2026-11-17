import { RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { successResponse } from './common/utils/response.util.js';
import type { AppConfig, SurepassConfig } from './config/configuration.js';
import { setupSwagger } from './docs/swagger.setup.js';
import { HealthService } from './health/health.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: false,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);

  const configService = app.get(ConfigService);
  const appConfig = configService.getOrThrow<AppConfig['app']>('app');
  const apiPrefix = appConfig.apiPrefix || 'api';

  app.use(
    helmet({
      contentSecurityPolicy: appConfig.env === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
      // Browser clients (Customer/Seller/Admin web) call this API cross-origin.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  const configuredOrigins = new Set(appConfig.corsOrigins);
  // Exact production origins. These stay allowed even when platform wildcards
  // are off, so a missing CORS_ORIGINS value cannot lock out the live apps.
  // api.polystorex.com is listed for the cutover; it has no DNS yet.
  const firstPartyOrigins = new Set([
    'https://polystorex.com',
    'https://www.polystorex.com',
    'https://customer.polystorex.com',
    'https://seller.polystorex.com',
    'https://admin.polystorex.com',
    'https://api.polystorex.com',
    'https://swaroop-customer-webapp.vercel.app',
    'https://swaroop-seller-webapp.vercel.app',
    'https://swaroop-admin-pi.vercel.app',
    'https://swaroop-website.vercel.app',
    'https://swaroop-backend-xzwkz.ondigitalocean.app',
  ]);
  const isLocalDevOrigin = (origin: string): boolean => {
    try {
      const { hostname } = new URL(origin);
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1'
      ) {
        return true;
      }
      return (
        /^10\.\d+\.\d+\.\d+$/.test(hostname) ||
        /^192\.168\.\d+\.\d+$/.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(hostname)
      );
    } catch {
      return false;
    }
  };
  const isAllowedOrigin = (origin: string | undefined): boolean => {
    if (!origin) {
      return true;
    }
    if (configuredOrigins.has(origin) || firstPartyOrigins.has(origin)) {
      return true;
    }
    // Localhost and LAN addresses are development-only.
    if (appConfig.env !== 'production' && isLocalDevOrigin(origin)) {
      return true;
    }
    // Opt-in only. Arbitrary *.vercel.app / *.ondigitalocean.app hosts are
    // unknown origins and are rejected unless CORS_ALLOW_PLATFORM_HOSTS=true.
    if (!appConfig.corsAllowPlatformHosts) {
      return false;
    }
    try {
      const { hostname } = new URL(origin);
      return (
        hostname.endsWith('.ondigitalocean.app') ||
        hostname.endsWith('.ondigitalocean.com') ||
        hostname.endsWith('.vercel.app') ||
        hostname === 'polystorex.com' ||
        hostname.endsWith('.polystorex.com')
      );
    } catch {
      return false;
    }
  };

  if (appConfig.env === 'production' && appConfig.corsAllowPlatformHosts) {
    logger.warn(
      'CORS_ALLOW_PLATFORM_HOSTS is on: any *.vercel.app / *.ondigitalocean.* origin is allowed. List exact client origins in CORS_ORIGINS and set CORS_ALLOW_PLATFORM_HOSTS=false for launch.',
    );
  }

  app.enableCors({
    origin: (origin, callback) => {
      callback(null, isAllowedOrigin(origin));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  });

  // Run onModuleDestroy (Prisma disconnect, background workers) on SIGTERM
  // so App Platform redeploys drain cleanly.
  app.enableShutdownHooks();

  app.setGlobalPrefix(apiPrefix, {
    exclude: [
      { path: 'docs', method: RequestMethod.GET },
      { path: 'docs-json', method: RequestMethod.GET },
    ],
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: appConfig.apiVersion || '1',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      stopAtFirstError: false,
    }),
  );

  if (appConfig.env !== 'production') {
    setupSwagger(app);
    logger.log(`Swagger docs available at /docs`);
  }

  // Infrastructure probe outside /api for load balancers / orchestration
  const healthService = app.get(HealthService);
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/health', async (_req: unknown, res: unknown) => {
    const response = res as {
      status: (code: number) => { json: (body: unknown) => void };
      json: (body: unknown) => void;
    };

    try {
      const data = await healthService.check();
      response.json(successResponse(data, 'Health check completed'));
    } catch {
      response.status(503).json({
        success: false,
        statusCode: 503,
        message: 'Service unavailable',
        error: 'Service Unavailable',
        timestamp: new Date().toISOString(),
        path: '/health',
      });
    }
  });

  await app.listen(appConfig.port, '0.0.0.0');

  logger.log(
    `${appConfig.name} listening on 0.0.0.0:${appConfig.port} [${appConfig.env}]`,
  );
  logger.log(`API base path: /${apiPrefix}/v${appConfig.apiVersion}`);
  logger.log(
    `Health probes: /health and /${apiPrefix}/v${appConfig.apiVersion}/health`,
  );
  const surepass = configService.get<SurepassConfig>('kyc.surepass');
  if (surepass?.baseUrl && surepass.token) {
    logger.log(
      `Surepass KYC: configured=true environment=${surepass.environment} host=${new URL(surepass.baseUrl).host}`,
    );
  } else {
    logger.warn(
      'Surepass KYC: configured=false. SUREPASS_API_BASE_URL / SUREPASS_API_TOKEN are not set, so PAN and GST checks are saved for manual review (PROVIDER_NOT_CONFIGURED).',
    );
  }
}

await bootstrap();
