import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { CustomersModule } from '../customers/index.js';
import { DocumentsModule } from '../documents/index.js';
import { MasterDataModule } from '../master-data/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { SellersModule } from '../sellers/index.js';
import { AdminGradeRequestsController } from './admin-grade-requests.controller.js';
import { AdminGradeRequestsService } from './admin-grade-requests.service.js';
import { CustomerGradeRequestsController } from './customer-grade-requests.controller.js';
import { CustomerGradeRequestsService } from './customer-grade-requests.service.js';
import { SellerGradeRequestsController } from './seller-grade-requests.controller.js';
import { SellerGradeRequestsService } from './seller-grade-requests.service.js';
import { GradeRequestSupport } from './grade-requests.support.js';

/**
 * New Grade Requests: a customer OR a seller asks for a grade that is not in the
 * catalogue, admins review it, map/create a catalogue grade, and the requester
 * tracks status. Standalone from PurchaseRequest. Blind marketplace: each side
 * only sees its own requests; sellers never see customer-origin requests.
 */
@Module({
  imports: [
    AuthModule,
    CustomersModule,
    DocumentsModule,
    MasterDataModule,
    NotificationsModule,
    SellersModule,
  ],
  controllers: [
    CustomerGradeRequestsController,
    SellerGradeRequestsController,
    AdminGradeRequestsController,
  ],
  providers: [
    GradeRequestSupport,
    CustomerGradeRequestsService,
    SellerGradeRequestsService,
    AdminGradeRequestsService,
  ],
})
export class GradeRequestsModule {}
