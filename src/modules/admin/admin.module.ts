import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { DocumentsModule } from '../documents/index.js';
import { MasterDataModule } from '../master-data/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { PaymentsModule } from '../payments/index.js';
import { ProcurementModule } from '../procurement/index.js';
import { AdminFinanceController } from '../payments/controllers/admin-finance.controller.js';
import { AdminAuditService } from './common/admin-audit.service.js';
import { AdminAuditLogsController } from './audit/admin-audit-logs.controller.js';
import { AdminAuditLogsService } from './audit/admin-audit-logs.service.js';
import { AdminComplianceController } from './compliance/admin-compliance.controller.js';
import { AdminComplianceService } from './compliance/admin-compliance.service.js';
import { AdminCustomersController } from './customers/admin-customers.controller.js';
import { AdminCustomersService } from './customers/admin-customers.service.js';
import { AdminDashboardController } from './dashboard/admin-dashboard.controller.js';
import { AdminDashboardService } from './dashboard/admin-dashboard.service.js';
import { AdminDocumentsController } from './documents/admin-documents.controller.js';
import { AdminDocumentsService } from './documents/admin-documents.service.js';
import { AdminGradesController } from './grades/admin-grades.controller.js';
import { AdminNotificationsController } from './notifications/admin-notifications.controller.js';
import { AdminOffersController } from './offers/admin-offers.controller.js';
import { AdminOffersService } from './offers/admin-offers.service.js';
import { AdminOrdersController } from './orders/admin-orders.controller.js';
import { AdminOrdersService } from './orders/admin-orders.service.js';
import { AdminPaymentsAliasController } from './payments/admin-payments-alias.controller.js';
import { AdminPricingController } from './pricing/admin-pricing.controller.js';
import { AdminPricingService } from './pricing/admin-pricing.service.js';
import { AdminProcurementController } from './procurement/admin-procurement.controller.js';
import { AdminProcurementService } from './procurement/admin-procurement.service.js';
import { AdminProductsController } from './products/admin-products.controller.js';
import { AdminProductsService } from './products/admin-products.service.js';
import { AdminPurchaseOrdersController } from './purchase-orders/admin-purchase-orders.controller.js';
import { AdminPurchaseOrdersService } from './purchase-orders/admin-purchase-orders.service.js';
import { AdminPurchaseRequestsController } from './purchase-requests/admin-purchase-requests.controller.js';
import { AdminReportsController } from './reports/admin-reports.controller.js';
import { AdminReportsService } from './reports/admin-reports.service.js';
import { AdminSearchController } from './search/admin-search.controller.js';
import { AdminSearchService } from './search/admin-search.service.js';
import { AdminCatalogController } from './catalog/admin-catalog.controller.js';
import { AdminCreditController } from './credit/admin-credit.controller.js';
import { AdminCreditService } from './credit/admin-credit.service.js';
import { AdminBulkLogisticsQuotesController } from './bulk-logistics-quotes/admin-bulk-logistics-quotes.controller.js';
import { AdminBulkLogisticsQuotesService } from './bulk-logistics-quotes/admin-bulk-logistics-quotes.service.js';
import { AdminSellersController } from './sellers/admin-sellers.controller.js';
import { AdminSellersService } from './sellers/admin-sellers.service.js';
import { AdminUsersController } from './users/admin-users.controller.js';
import { AdminUsersService } from './users/admin-users.service.js';

const adminProviders = [
  AdminAuditService,
  AdminDashboardService,
  AdminUsersService,
  AdminSellersService,
  AdminCustomersService,
  AdminProductsService,
  AdminOffersService,
  AdminPurchaseOrdersService,
  AdminOrdersService,
  AdminDocumentsService,
  AdminComplianceService,
  AdminPricingService,
  AdminReportsService,
  AdminAuditLogsService,
  AdminSearchService,
  AdminProcurementService,
  AdminCreditService,
  AdminBulkLogisticsQuotesService,
];

@Module({
  imports: [
    AuthModule,
    ProcurementModule,
    PaymentsModule,
    MasterDataModule,
    NotificationsModule,
    DocumentsModule,
  ],
  controllers: [
    AdminProcurementController,
    AdminFinanceController,
    AdminDashboardController,
    AdminCatalogController,
    AdminUsersController,
    AdminSellersController,
    AdminCustomersController,
    AdminGradesController,
    AdminProductsController,
    AdminOffersController,
    AdminPurchaseRequestsController,
    AdminPurchaseOrdersController,
    AdminPaymentsAliasController,
    AdminOrdersController,
    AdminDocumentsController,
    AdminComplianceController,
    AdminPricingController,
    AdminNotificationsController,
    AdminReportsController,
    AdminAuditLogsController,
    AdminSearchController,
    AdminCreditController,
    AdminBulkLogisticsQuotesController,
  ],
  providers: adminProviders,
  exports: [AdminProcurementService, AdminAuditService],
})
export class AdminModule {}
