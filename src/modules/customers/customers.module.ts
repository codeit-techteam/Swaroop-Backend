import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { DocumentsModule } from '../documents/index.js';
import { ProcurementModule } from '../procurement/index.js';
import { CartController } from './cart/cart.controller.js';
import { CartService } from './cart/cart.service.js';
import { CustomerAuditService } from './common/customer-audit.service.js';
import { CustomerContextService } from './common/customer-context.service.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { DashboardService } from './dashboard/dashboard.service.js';
import { CustomerDocumentsController } from './documents/documents.controller.js';
import { CustomerDocumentsService } from './documents/documents.service.js';
import { MarketplaceController } from './marketplace/marketplace.controller.js';
import { MarketplaceService } from './marketplace/marketplace.service.js';
import { OffersController } from './offers/offers.controller.js';
import { OffersService } from './offers/offers.service.js';
import { ProductsController } from './products/products.controller.js';
import { ProductsService } from './products/products.service.js';
import { PurchaseRequestsController } from './purchase-requests/purchase-requests.controller.js';
import { PurchaseRequestsService } from './purchase-requests/purchase-requests.service.js';

@Module({
  imports: [AuthModule, ProcurementModule, DocumentsModule],
  controllers: [
    MarketplaceController,
    ProductsController,
    OffersController,
    CartController,
    PurchaseRequestsController,
    DashboardController,
    CustomerDocumentsController,
  ],
  providers: [
    CustomerContextService,
    CustomerAuditService,
    MarketplaceService,
    ProductsService,
    OffersService,
    CartService,
    PurchaseRequestsService,
    DashboardService,
    CustomerDocumentsService,
  ],
  exports: [
    CustomerContextService,
    CustomerAuditService,
    MarketplaceService,
    ProductsService,
    OffersService,
    CartService,
    PurchaseRequestsService,
    DashboardService,
    CustomerDocumentsService,
  ],
})
export class CustomersModule {}
