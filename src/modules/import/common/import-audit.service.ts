import { Injectable } from '@nestjs/common';
import { EntityOwnerType } from '../../../generated/prisma/client.js';
import { AdminAuditService } from '../../admin/common/admin-audit.service.js';

export const IMPORT_AUDIT_ACTIONS = {
  BUY_CREATED: 'IMPORT_BUY_CREATED',
  BUY_UPDATED: 'IMPORT_BUY_UPDATED',
  BUY_PUBLISHED: 'IMPORT_BUY_PUBLISHED',
  BUY_CANCELLED: 'IMPORT_BUY_CANCELLED',
  BUY_EXPIRED: 'IMPORT_BUY_EXPIRED',
  BUY_DELETED: 'IMPORT_BUY_DRAFT_DELETED',
  SELL_CREATED: 'IMPORT_SELL_CREATED',
  SELL_UPDATED: 'IMPORT_SELL_UPDATED',
  SELL_PUBLISHED: 'IMPORT_SELL_PUBLISHED',
  SELL_PAUSED: 'IMPORT_SELL_PAUSED',
  SELL_RESUMED: 'IMPORT_SELL_RESUMED',
  SELL_CANCELLED: 'IMPORT_SELL_CANCELLED',
  SELL_EXPIRED: 'IMPORT_SELL_EXPIRED',
  SELL_DELETED: 'IMPORT_SELL_DRAFT_DELETED',
  STATUS_CHANGED_BY_ADMIN: 'IMPORT_LISTING_STATUS_CHANGED_BY_ADMIN',
  DOCUMENT_UPLOADED: 'IMPORT_DOCUMENT_UPLOADED',
  DOCUMENT_DELETED: 'IMPORT_DOCUMENT_DELETED',
  DOCUMENT_ACCESSED_BY_ADMIN: 'IMPORT_DOCUMENT_ACCESSED_BY_ADMIN',
  NEGOTIATION_STARTED: 'IMPORT_NEGOTIATION_STARTED',
  COUNTEROFFER_CREATED: 'IMPORT_COUNTEROFFER_CREATED',
  COUNTEROFFER_ACCEPTED: 'IMPORT_COUNTEROFFER_ACCEPTED',
  COUNTEROFFER_REJECTED: 'IMPORT_COUNTEROFFER_REJECTED',
  NEGOTIATION_WITHDRAWN: 'IMPORT_NEGOTIATION_WITHDRAWN',
  NEGOTIATION_EXPIRED: 'IMPORT_NEGOTIATION_EXPIRED',
  DEAL_PARTY_CONFIRMED: 'IMPORT_DEAL_PARTY_CONFIRMED',
  DEAL_CONFIRMED: 'IMPORT_DEAL_CONFIRMED',
  DEAL_STATUS_CHANGED_BY_ADMIN: 'IMPORT_DEAL_STATUS_CHANGED_BY_ADMIN',
  DEAL_FULFILMENT_CHANGED: 'IMPORT_DEAL_FULFILMENT_CHANGED',
  SHIPMENT_CREATED: 'IMPORT_SHIPMENT_CREATED',
  SHIPMENT_UPDATED: 'IMPORT_SHIPMENT_UPDATED',
  SHIPMENT_STATUS_CHANGED: 'IMPORT_SHIPMENT_STATUS_CHANGED',
  MATCHES_RECOMPUTED: 'IMPORT_MATCHES_RECOMPUTED',
  MASTER_CREATED: 'IMPORT_MASTER_CREATED',
  MASTER_UPDATED: 'IMPORT_MASTER_UPDATED',
  MASTER_STATUS_CHANGED: 'IMPORT_MASTER_STATUS_CHANGED',
  SETTINGS_UPDATED: 'IMPORT_SETTINGS_UPDATED',
} as const;

export type ImportAuditAction =
  (typeof IMPORT_AUDIT_ACTIONS)[keyof typeof IMPORT_AUDIT_ACTIONS];

export type ImportAuditEntry = {
  action: ImportAuditAction;
  actorUserId: string | null;
  actorRole: string;
  organizationId?: string | null;
  entityType: EntityOwnerType;
  entityId?: string;
  previousData?: unknown;
  newData?: unknown;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class ImportAuditService {
  constructor(private readonly audit: AdminAuditService) {}

  log(entry: ImportAuditEntry) {
    return this.audit.log({
      action: entry.action,
      actorUserId: entry.actorUserId ?? undefined,
      organizationId: entry.organizationId ?? undefined,
      entityType: entry.entityType,
      entityId: entry.entityId,
      previousData: entry.previousData,
      newData: entry.newData,
      metadata: {
        module: 'IMPORT',
        actorRole: entry.actorRole,
        ...entry.metadata,
      },
    });
  }
}
