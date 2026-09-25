import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor.js';
import configuration from './config/configuration.js';
import { validateEnv } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { AdminModule } from './modules/admin/index.js';
import { AnalyticsModule } from './modules/analytics/index.js';
import { AuditModule } from './modules/audit/index.js';
import { AuthModule } from './modules/auth/index.js';
import { CustomersModule } from './modules/customers/index.js';
import { DocumentsModule } from './modules/documents/index.js';
import { GradesModule } from './modules/grades/index.js';
import { InventoryModule } from './modules/inventory/index.js';
import { MasterDataModule } from './modules/master-data/index.js';
import { NotificationsModule } from './modules/notifications/index.js';
import { OffersModule } from './modules/offers/index.js';
import { OrdersModule } from './modules/orders/index.js';
import { OrganizationsModule } from './modules/organizations/index.js';
import { PaymentsModule } from './modules/payments/index.js';
import { PricingModule } from './modules/pricing/index.js';
import { ProcurementModule } from './modules/procurement/index.js';
import { ProductsModule } from './modules/products/index.js';
import { PurchaseRequestsModule } from './modules/purchase-requests/index.js';
import { RolesPermissionsModule } from './modules/roles-permissions/index.js';
import { SellersModule } from './modules/sellers/index.js';
import { SettlementsModule } from './modules/settlements/index.js';
import { LogisticsModule } from './modules/logistics/index.js';
import { CmsModule } from './modules/cms/index.js';
import { ShipmentsModule } from './modules/shipments/index.js';
import { SupportModule } from './modules/support/index.js';
import { UsersModule } from './modules/users/index.js';
import { StorageModule } from './storage/storage.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      load: [configuration],
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isProduction =
          configService.get<string>('app.env') === 'production';
        const level = configService.get<string>('app.logLevel') ?? 'info';

        return {
          pinoHttp: {
            level,
            transport: isProduction
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    colorize: true,
                    translateTime: 'SYS:standard',
                  },
                },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-api-key"]',
                'res.headers["set-cookie"]',
                'JWT_SECRET',
                'DATABASE_URL',
                'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
                'CLOUDFLARE_R2_ACCESS_KEY_ID',
                '*.password',
                '*.otp',
                '*.token',
                '*.secret',
              ],
              censor: '[Redacted]',
            },
            customProps: () => ({
              context: 'HTTP',
            }),
            autoLogging: true,
          },
        };
      },
    }),
    DatabaseModule,
    StorageModule,
    HealthModule,
    // Phase 2 domain boundaries (no business REST APIs yet)
    AuthModule,
    UsersModule,
    RolesPermissionsModule,
    OrganizationsModule,
    CustomersModule,
    SellersModule,
    AdminModule,
    AnalyticsModule,
    GradesModule,
    MasterDataModule,
    ProductsModule,
    InventoryModule,
    OffersModule,
    PricingModule,
    ProcurementModule,
    PurchaseRequestsModule,
    OrdersModule,
    PaymentsModule,
    LogisticsModule,
    CmsModule,
    ShipmentsModule,
    DocumentsModule,
    NotificationsModule,
    SettlementsModule,
    SupportModule,
    AuditModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseTransformInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
})
export class AppModule {}
