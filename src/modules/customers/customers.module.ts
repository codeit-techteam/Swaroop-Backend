import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { DocumentsModule } from '../documents/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { PaymentsModule } from '../payments/index.js';
import { ProcurementModule } from '../procurement/index.js';
import { CartController } from './cart/cart.controller.js';
import { CartService } from './cart/cart.service.js';
import { CustomerAuditService } from './common/customer-audit.service.js';
import { CustomerContextService } from './common/customer-context.service.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { DashboardService } from './dashboard/dashboard.service.js';
import { CustomerDocumentsController } from './documents/documents.controller.js';
import { CustomerDocumentsService } from './documents/documents.service.js';
import { CustomerCreditController } from './credit/customer-credit.controller.js';
import { CustomerCreditService } from './credit/customer-credit.service.js';
import { BulkLogisticsQuotesController } from './bulk-logistics-quotes/bulk-logistics-quotes.controller.js';
import { BulkLogisticsQuotesService } from './bulk-logistics-quotes/bulk-logistics-quotes.service.js';
import { MarketplaceController } from './marketplace/marketplace.controller.js';
import { MarketplaceService } from './marketplace/marketplace.service.js';
import { OffersController } from './offers/offers.controller.js';
import { OffersService } from './offers/offers.service.js';
import { ProductsController } from './products/products.controller.js';
import { ProductsService } from './products/products.service.js';
import { PurchaseRequestsController } from './purchase-requests/purchase-requests.controller.js';
import { PurchaseRequestsService } from './purchase-requests/purchase-requests.service.js';
import { CheckoutController } from './checkout/checkout.controller.js';
import { CheckoutService } from './checkout/checkout.service.js';
import { SellerMatchingService } from './checkout/seller-matching.service.js';
import { CustomerAddressesController } from './addresses/addresses.controller.js';
import { CustomerAddressesService } from './addresses/addresses.service.js';
import { CustomerOrdersController } from './orders/customer-orders.controller.js';
import { CustomerOrdersService } from './orders/customer-orders.service.js';

@Module({
  imports: [
    AuthModule,
    ProcurementModule,
    DocumentsModule,
    PaymentsModule,
    NotificationsModule,
  ],
  controllers: [
    MarketplaceController,
    ProductsController,
    OffersController,
    CartController,
    PurchaseRequestsController,
    CheckoutController,
    CustomerAddressesController,
    CustomerOrdersController,
    DashboardController,
    CustomerDocumentsController,
    CustomerCreditController,
    BulkLogisticsQuotesController,
  ],
  providers: [
    CustomerContextService,
    CustomerAuditService,
    MarketplaceService,
    ProductsService,
    OffersService,
    CartService,
    PurchaseRequestsService,
    CheckoutService,
    CustomerAddressesService,
    SellerMatchingService,
    CustomerOrdersService,
    DashboardService,
    CustomerDocumentsService,
    CustomerCreditService,
    BulkLogisticsQuotesService,
  ],
  exports: [
    CustomerContextService,
    CustomerAuditService,
    MarketplaceService,
    ProductsService,
    OffersService,
    CartService,
    PurchaseRequestsService,
    CheckoutService,
    CustomerAddressesService,
    SellerMatchingService,
    CustomerOrdersService,
    DashboardService,
    CustomerDocumentsService,
    CustomerCreditService,
    BulkLogisticsQuotesService,
  ],
})
export class CustomersModule {}
