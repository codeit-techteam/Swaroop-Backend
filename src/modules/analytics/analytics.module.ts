import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { PaymentsModule } from '../payments/index.js';
import { AdminAnalyticsController } from './controllers/admin-analytics.controller.js';
import {
  ProcurementAnalyticsService,
  SalesAnalyticsService,
} from './services/sales-procurement-analytics.service.js';
import {
  CatalogInventoryAnalyticsService,
  LogisticsSettlementAnalyticsService,
  OverviewAnalyticsService,
  PartyAnalyticsService,
  PaymentAnalyticsService,
} from './services/domain-analytics.service.js';

const providers = [
  SalesAnalyticsService,
  ProcurementAnalyticsService,
  PaymentAnalyticsService,
  PartyAnalyticsService,
  CatalogInventoryAnalyticsService,
  LogisticsSettlementAnalyticsService,
  OverviewAnalyticsService,
];

@Module({
  imports: [AuthModule, PaymentsModule],
  controllers: [AdminAnalyticsController],
  providers,
  exports: providers,
})
export class AnalyticsModule {}
