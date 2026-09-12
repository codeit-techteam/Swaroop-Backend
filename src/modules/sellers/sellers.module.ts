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
import { OffersController } from './offers/offers.controller.js';
import { OffersService } from './offers/offers.service.js';
import { OnboardingController } from './onboarding/onboarding.controller.js';
import { OnboardingService } from './onboarding/onboarding.service.js';
import { PricingController } from './pricing/pricing.controller.js';
import { PricingService } from './pricing/pricing.service.js';
import { ProductsController } from './products/products.controller.js';
import { ProductsService } from './products/products.service.js';
import { ProfileController } from './profile/profile.controller.js';
import { ProfileService } from './profile/profile.service.js';
import { PurchaseRequestsController } from './purchase-requests/purchase-requests.controller.js';
import { PurchaseRequestsService } from './purchase-requests/purchase-requests.service.js';

@Module({
  imports: [AuthModule, ProcurementModule, DocumentsModule],
  controllers: [
    ProfileController,
    OnboardingController,
    CompanyController,
    DocumentsController,
    ProductsController,
    InventoryController,
    OffersController,
    PricingController,
    PurchaseRequestsController,
    DashboardController,
    DashboardAliasController,
  ],
  providers: [
    SellerContextService,
    SellerAuditService,
    ProfileService,
    OnboardingService,
    CompanyService,
    DocumentsService,
    ProductsService,
    InventoryService,
    OffersService,
    PricingService,
    PurchaseRequestsService,
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
    InventoryService,
    OffersService,
    PricingService,
    PurchaseRequestsService,
  ],
})
export class SellersModule {}
