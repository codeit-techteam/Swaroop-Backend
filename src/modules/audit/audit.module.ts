import { Module } from '@nestjs/common';
import { AdminAuditService } from '../admin/common/admin-audit.service.js';

/**
 * Audit domain module — shared AdminAuditService for write helpers.
 * Admin read APIs live under AdminModule (`/admin/audit-logs`).
 */
@Module({
  providers: [AdminAuditService],
  exports: [AdminAuditService],
})
export class AuditModule {}
