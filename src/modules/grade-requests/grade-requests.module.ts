import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { CustomersModule } from '../customers/index.js';
import { DocumentsModule } from '../documents/index.js';
import { MasterDataModule } from '../master-data/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { AdminGradeRequestsController } from './admin-grade-requests.controller.js';
import { AdminGradeRequestsService } from './admin-grade-requests.service.js';
import { CustomerGradeRequestsController } from './customer-grade-requests.controller.js';
import { CustomerGradeRequestsService } from './customer-grade-requests.service.js';
import { GradeRequestSupport } from './grade-requests.support.js';

/**
 * New Grade Requests: a customer asks for a grade that is not in the catalogue,
 * admins review it, map/create a catalogue grade, and the customer tracks status.
 * Standalone from PurchaseRequest, never visible to sellers.
 */
@Module({
  imports: [
    AuthModule,
    CustomersModule,
    DocumentsModule,
    MasterDataModule,
    NotificationsModule,
  ],
  controllers: [CustomerGradeRequestsController, AdminGradeRequestsController],
  providers: [
    GradeRequestSupport,
    CustomerGradeRequestsService,
    AdminGradeRequestsService,
  ],
})
export class GradeRequestsModule {}
