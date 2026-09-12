import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { DocumentsModule } from '../documents/index.js';
import { PaymentsModule } from '../payments/index.js';
import { StorageModule } from '../../storage/storage.module.js';
import { DispatchStateService } from './common/dispatch-state.service.js';
import { ShipmentStateService } from './common/shipment-state.service.js';
import { DeliveryStateService } from './common/delivery-state.service.js';
import { LogisticsEventsService } from './common/logistics-events.service.js';
import { CustomerLogisticsController } from './controllers/customer-logistics.controller.js';
import { SellerLogisticsController } from './controllers/seller-logistics.controller.js';
import { AdminLogisticsController } from './controllers/admin-logistics.controller.js';
import { LogisticsActorService } from './services/logistics-actor.service.js';
import { QuantityService } from './services/quantity.service.js';
import { VehicleService } from './services/vehicle.service.js';
import { DriverService } from './services/driver.service.js';
import { VehicleSlotService } from './services/vehicle-slot.service.js';
import { EwayBillService } from './services/eway-bill.service.js';
import { DispatchService } from './services/dispatch.service.js';
import { ShipmentService } from './services/shipment.service.js';
import { DeliveryService } from './services/delivery.service.js';
import { LogisticsSummaryService } from './services/logistics-summary.service.js';
import { InvoiceLifecycleService } from './services/invoice-lifecycle.service.js';

const logisticsProviders = [
  LogisticsEventsService,
  DispatchStateService,
  ShipmentStateService,
  DeliveryStateService,
  LogisticsActorService,
  QuantityService,
  VehicleService,
  DriverService,
  VehicleSlotService,
  EwayBillService,
  DispatchService,
  ShipmentService,
  DeliveryService,
  LogisticsSummaryService,
  InvoiceLifecycleService,
];

@Module({
  imports: [AuthModule, PaymentsModule, StorageModule, DocumentsModule],
  controllers: [
    CustomerLogisticsController,
    SellerLogisticsController,
    AdminLogisticsController,
  ],
  providers: logisticsProviders,
  exports: [
    DispatchService,
    ShipmentService,
    DeliveryService,
    VehicleService,
    DriverService,
    VehicleSlotService,
    EwayBillService,
    LogisticsSummaryService,
    QuantityService,
    InvoiceLifecycleService,
  ],
})
export class LogisticsModule {}
