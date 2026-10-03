import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { AuthModule } from '../auth/index.js';
import { DocumentsModule } from '../documents/index.js';
import { NotificationsModule } from '../notifications/index.js';
import {
  AdminImportController,
  AdminImportMasterController,
} from './admin/admin-import.controller.js';
import { AdminImportMasterService } from './admin/admin-import-master.service.js';
import { AdminImportService } from './admin/admin-import.service.js';
import { ImportActorService } from './common/import-actor.service.js';
import { ImportAuditService } from './common/import-audit.service.js';
import { ImportFeatureGuard } from './common/import-feature.guard.js';
import { ImportIdempotencyService } from './common/import-idempotency.service.js';
import { ImportLifecycleService } from './common/import-lifecycle.service.js';
import { ImportMasterService } from './common/import-master.service.js';
import { ImportNotifierService } from './common/import-notifier.service.js';
import { ImportReferenceService } from './common/import-reference.service.js';
import { ImportSettingsService } from './common/import-settings.service.js';
import { ImportDealsService } from './deals/import-deals.service.js';
import { ImportListingDocumentsService } from './documents/import-listing-documents.service.js';
import {
  ImportExtractor,
  UnavailableImportExtractor,
} from './extraction/import-extraction.service.js';
import { ImportExpiryWorker } from './import-expiry.worker.js';
import {
  ImportBuyController,
  ImportConfigController,
  ImportDealsController,
  ImportListingDocumentsController,
  ImportMasterDataController,
  ImportNegotiationsController,
  ImportSellController,
  ImportShipmentsController,
} from './import.controllers.js';
import { ImportListingsService } from './listings/import-listings.service.js';
import { ImportMatchingService } from './matching/import-matching.service.js';
import { ImportNegotiationsService } from './negotiations/import-negotiations.service.js';
import { ImportShipmentsService } from './shipments/import-shipments.service.js';

/**
 * Import trading: international BUY RFQs (customers) and SELL offers (sellers),
 * blind negotiation, rule-based matching, two-party deal confirmation and
 * seller/Admin-managed shipment tracking.
 */
@Module({
  imports: [AuthModule, AuditModule, DocumentsModule, NotificationsModule],
  controllers: [
    ImportConfigController,
    ImportMasterDataController,
    ImportBuyController,
    ImportSellController,
    ImportListingDocumentsController,
    ImportNegotiationsController,
    ImportDealsController,
    ImportShipmentsController,
    AdminImportMasterController,
    AdminImportController,
  ],
  providers: [
    ImportFeatureGuard,
    ImportActorService,
    ImportAuditService,
    ImportIdempotencyService,
    ImportLifecycleService,
    ImportMasterService,
    ImportNotifierService,
    ImportReferenceService,
    ImportSettingsService,
    ImportMatchingService,
    ImportListingsService,
    ImportListingDocumentsService,
    ImportNegotiationsService,
    ImportDealsService,
    ImportShipmentsService,
    AdminImportMasterService,
    AdminImportService,
    ImportExpiryWorker,
    { provide: ImportExtractor, useClass: UnavailableImportExtractor },
  ],
  exports: [ImportMatchingService, ImportExtractor],
})
export class ImportModule {}
