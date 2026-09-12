import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * OpenAPI / Swagger setup.
 * Phase 3 documents centralized Auth endpoints with Bearer JWT.
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('SWAROOP Centralized Backend API')
    .setDescription(
      [
        'Single source of truth REST API for the SWAROOP / PetroTrade B2B marketplace.',
        '',
        'Consumed by:',
        '- Customer Mobile App',
        '- Customer Web App',
        '- Seller Mobile App',
        '- Seller Web App',
        '- Admin Web Panel',
        '',
        'Phase 3: Centralized Authentication & Authorization (`/api/v1/auth/*`).',
        'Use `Authorization: Bearer <accessToken>` for protected routes.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Access token from /api/v1/auth/login or /api/v1/auth/otp/verify',
      },
      'bearer',
    )
    .addTag('Health', 'Infrastructure health checks')
    .addTag('Auth', 'Centralized authentication and authorization')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });
}
