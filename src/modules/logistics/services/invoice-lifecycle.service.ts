import { Injectable } from '@nestjs/common';
import { FinanceInvoiceService } from '../../payments/services/finance-invoice.service.js';

/**
 * Thin hooks for invoice lifecycle around logistics milestones.
 * Does not auto-issue tax invoices — Phase 8 draft rules remain authoritative.
 */
@Injectable()
export class InvoiceLifecycleService {
  constructor(private readonly invoices: FinanceInvoiceService) {}

  async onShipmentDispatched(_shipmentId: string): Promise<void> {
    // Intentionally no-op: tax invoice remains DRAFT until finance rules allow issue.
    void this.invoices;
  }

  async onDeliveryCompleted(_deliveryId: string): Promise<void> {
    void this.invoices;
  }
}
