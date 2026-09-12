import { Module } from '@nestjs/common';
import { DocumentStateService } from './common/document-state.service.js';
import { DocumentsCoreService } from './services/documents-core.service.js';

@Module({
  providers: [DocumentStateService, DocumentsCoreService],
  exports: [DocumentStateService, DocumentsCoreService],
})
export class DocumentsModule {}
