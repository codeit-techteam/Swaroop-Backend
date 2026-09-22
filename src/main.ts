import { RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { successResponse } from './common/utils/response.util.js';
import type { AppConfig } from './config/configuration.js';
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

  app.enableCors({
    origin: appConfig.env === 'production' ? appConfig.corsOrigins : true,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Request-Id'],
  });

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
}

await bootstrap();
