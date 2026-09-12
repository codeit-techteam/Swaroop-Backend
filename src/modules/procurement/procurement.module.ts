import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/index.js';
import { CommercialAcceptanceService } from './common/commercial-acceptance.service.js';
import { NegotiationService } from './common/negotiation.service.js';
import { PrEventsService } from './common/pr-events.service.js';
import { PrStateService } from './common/pr-state.service.js';
import { PurchaseOrderService } from './common/purchase-order.service.js';

/**
 * Phase 7 shared procurement workflow services.
 * Consumed by Sellers, Customers, and Admin modules.
 * Imports PaymentsModule for Phase 8 finance bootstrap on commercial accept.
 */
@Module({
  imports: [PaymentsModule],
  providers: [
    PrStateService,
    PrEventsService,
    NegotiationService,
    PurchaseOrderService,
    CommercialAcceptanceService,
  ],
  exports: [
    PrStateService,
    PrEventsService,
    NegotiationService,
    PurchaseOrderService,
    CommercialAcceptanceService,
  ],
})
export class ProcurementModule {}
