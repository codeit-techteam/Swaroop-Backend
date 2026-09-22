import { Module } from '@nestjs/common';
import { DocumentStateService } from './common/document-state.service.js';
import { DocumentsCoreService } from './services/documents-core.service.js';
import { ProductDocumentsQueryService } from './services/product-documents-query.service.js';

@Module({
  providers: [
    DocumentStateService,
    DocumentsCoreService,
    ProductDocumentsQueryService,
  ],
  exports: [
    DocumentStateService,
    DocumentsCoreService,
    ProductDocumentsQueryService,
  ],
})
export class DocumentsModule {}
