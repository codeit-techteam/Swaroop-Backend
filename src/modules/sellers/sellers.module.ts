import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { DocumentsModule } from '../documents/index.js';
import { ProcurementModule } from '../procurement/index.js';
import { SellerAuditService } from './common/seller-audit.service.js';
import { SellerContextService } from './common/seller-context.service.js';
import { CompanyController } from './company/company.controller.js';
import { CompanyService } from './company/company.service.js';
import {
  DashboardAliasController,
  DashboardController,
} from './dashboard/dashboard.controller.js';
import { DashboardService } from './dashboard/dashboard.service.js';
import { DocumentsController } from './documents/documents.controller.js';
import { DocumentsService } from './documents/documents.service.js';
import { InventoryController } from './inventory/inventory.controller.js';
import { InventoryService } from './inventory/inventory.service.js';
import { SellerLocationsController } from './locations/locations.controller.js';
import { SellerLocationsService } from './locations/locations.service.js';
import { OffersController } from './offers/offers.controller.js';
import { OffersService } from './offers/offers.service.js';
import { OnboardingDocumentsService } from './onboarding/onboarding-documents.service.js';
import { OnboardingController } from './onboarding/onboarding.controller.js';
import { OnboardingService } from './onboarding/onboarding.service.js';
import { PricingController } from './pricing/pricing.controller.js';
import { PricingService } from './pricing/pricing.service.js';
import { ProductsController } from './products/products.controller.js';
import { ProductsService } from './products/products.service.js';
import { ProductDocumentsController } from './products/product-documents.controller.js';
import { ProductDocumentsService } from './products/product-documents.service.js';
import { ProfileController } from './profile/profile.controller.js';
import { ProfileService } from './profile/profile.service.js';
import { PurchaseRequestsController } from './purchase-requests/purchase-requests.controller.js';
import { PurchaseRequestsService } from './purchase-requests/purchase-requests.service.js';
import { SellerOrdersController } from './orders/seller-orders.controller.js';
import { SellerOrdersService } from './orders/seller-orders.service.js';
import { SellerPriceRevisionsController } from './price-revisions/price-revisions.controller.js';
import { SellerPriceRevisionsService } from './price-revisions/price-revisions.service.js';
import { SellerProcurementWorkbenchController } from './procurement/seller-procurement-workbench.controller.js';
import { SellerProcurementWorkbenchService } from './procurement/seller-procurement-workbench.service.js';

@Module({
  imports: [AuthModule, ProcurementModule, DocumentsModule],
  controllers: [
    ProfileController,
    OnboardingController,
    CompanyController,
    DocumentsController,
    ProductsController,
    ProductDocumentsController,
    InventoryController,
    OffersController,
    SellerLocationsController,
    PricingController,
    PurchaseRequestsController,
    SellerOrdersController,
    SellerPriceRevisionsController,
    SellerProcurementWorkbenchController,
    DashboardController,
    DashboardAliasController,
  ],
  providers: [
    SellerContextService,
    SellerAuditService,
    ProfileService,
    OnboardingService,
    OnboardingDocumentsService,
    CompanyService,
    DocumentsService,
    ProductsService,
    ProductDocumentsService,
    InventoryService,
    OffersService,
    SellerLocationsService,
    PricingService,
    PurchaseRequestsService,
    SellerOrdersService,
    SellerPriceRevisionsService,
    SellerProcurementWorkbenchService,
    DashboardService,
  ],
  exports: [
    SellerContextService,
    SellerAuditService,
    ProfileService,
    OnboardingService,
    CompanyService,
    DocumentsService,
    DashboardService,
    ProductsService,
    ProductDocumentsService,
    InventoryService,
    OffersService,
    SellerLocationsService,
    PricingService,
    PurchaseRequestsService,
    SellerOrdersService,
    SellerPriceRevisionsService,
    SellerProcurementWorkbenchService,
  ],
})
export class SellersModule {}
