import { Injectable } from '@nestjs/common';
import {
  DispatchStatus,
  DocumentCategory,
  EWayBillStatus,
  type EWayBill,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { DocumentsCoreService } from '../../documents/services/documents-core.service.js';
import { LogisticsException } from '../common/logistics.errors.js';
import { LogisticsEventsService } from '../common/logistics-events.service.js';
import { DispatchStateService } from '../common/dispatch-state.service.js';
import {
  toAdminEwayBill,
  toSellerEwayBill,
} from '../common/blind-logistics.mapper.js';

export type UpsertEwayBillInput = {
  ewayBillNumber: string;
  validFrom?: string;
  validUntil?: string;
  documentKey?: string;
  documentId?: string;
};

@Injectable()
export class EwayBillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: LogisticsEventsService,
    private readonly dispatchState: DispatchStateService,
    private readonly documents: DocumentsCoreService,
  ) {}

  async getForDispatch(dispatchId: string, sellerOrgId?: string) {
    const dispatch = await this.prisma.dispatch.findFirst({
      where: {
        id: dispatchId,
        deletedAt: null,
        ...(sellerOrgId ? { sellerOrgId } : {}),
      },
      include: { ewayBills: { orderBy: { createdAt: 'desc' } } },
    });
    if (!dispatch) {
      throw new LogisticsException('DISPATCH_NOT_FOUND');
    }
    return dispatch.ewayBills;
  }

  async upsert(
    dispatchId: string,
    input: UpsertEwayBillInput,
    opts?: { sellerOrgId?: string; userId?: string; role?: string },
  ): Promise<EWayBill> {
    const dispatch = await this.prisma.dispatch.findFirst({
      where: {
        id: dispatchId,
        deletedAt: null,
        ...(opts?.sellerOrgId ? { sellerOrgId: opts.sellerOrgId } : {}),
      },
    });
    if (!dispatch) {
      throw new LogisticsException('DISPATCH_NOT_FOUND');
    }

    if (input.documentId) {
      await this.documents.assertDocumentCategory(
        input.documentId,
        DocumentCategory.E_WAY_BILL,
      );
    }

    const validFrom = input.validFrom ? new Date(input.validFrom) : new Date();
    const validUntil = input.validUntil
      ? new Date(input.validUntil)
      : undefined;

    let status: EWayBillStatus = EWayBillStatus.VALID;
    if (validUntil && validUntil.getTime() < Date.now()) {
      status = EWayBillStatus.EXPIRED;
    } else if (!input.ewayBillNumber?.trim()) {
      throw new LogisticsException('EWAY_BILL_INVALID');
    }

    const existing = await this.prisma.eWayBill.findFirst({
      where: { dispatchId },
      orderBy: { createdAt: 'desc' },
    });

    const eway = existing
      ? await this.prisma.eWayBill.update({
          where: { id: existing.id },
          data: {
            ewayBillNumber: input.ewayBillNumber.trim(),
            validFrom,
            validUntil: validUntil ?? null,
            documentKey: input.documentKey,
            documentId: input.documentId,
            status,
            generatedAt: new Date(),
          },
        })
      : await this.prisma.eWayBill.create({
          data: {
            dispatchId,
            purchaseOrderId: dispatch.purchaseOrderId,
            ewayBillNumber: input.ewayBillNumber.trim(),
            validFrom,
            validUntil: validUntil ?? null,
            documentKey: input.documentKey,
            documentId: input.documentId,
            status,
            generatedAt: new Date(),
          },
        });

    await this.events.record(this.prisma, {
      purchaseOrderId: dispatch.purchaseOrderId,
      dispatchId,
      eventType: 'EWAY_BILL_ADDED',
      actorRole: opts?.role,
      actorUserId: opts?.userId,
      metadata: { ewayBillId: eway.id, status },
    });

    if (
      status === EWayBillStatus.VALID &&
      dispatch.vehicleId &&
      (dispatch.status === DispatchStatus.AWAITING_EWAY_BILL ||
        dispatch.status === DispatchStatus.VEHICLE_ASSIGNED)
    ) {
      this.dispatchState.assertTransition(
        dispatch.status,
        DispatchStatus.READY_FOR_DISPATCH,
      );
      await this.prisma.dispatch.update({
        where: { id: dispatchId },
        data: { status: DispatchStatus.READY_FOR_DISPATCH },
      });
      await this.events.record(this.prisma, {
        purchaseOrderId: dispatch.purchaseOrderId,
        dispatchId,
        eventType: 'DISPATCH_READY',
        actorRole: opts?.role,
        actorUserId: opts?.userId,
      });
    }

    return eway;
  }

  async validate(
    dispatchId: string,
    actor?: { userId?: string; role?: string },
  ): Promise<EWayBill> {
    const bills = await this.getForDispatch(dispatchId);
    const latest = bills[0];
    if (!latest) {
      throw new LogisticsException('EWAY_BILL_REQUIRED');
    }
    if (latest.validUntil && latest.validUntil.getTime() < Date.now()) {
      await this.prisma.eWayBill.update({
        where: { id: latest.id },
        data: { status: EWayBillStatus.EXPIRED },
      });
      throw new LogisticsException('EWAY_BILL_EXPIRED');
    }

    const updated = await this.prisma.eWayBill.update({
      where: { id: latest.id },
      data: { status: EWayBillStatus.VALID },
    });
    await this.events.record(this.prisma, {
      dispatchId,
      eventType: 'EWAY_BILL_VALIDATED',
      actorRole: actor?.role,
      actorUserId: actor?.userId,
      metadata: { ewayBillId: updated.id },
    });
    return updated;
  }

  async cancel(
    dispatchId: string,
    actor?: { userId?: string; role?: string },
  ): Promise<EWayBill> {
    const bills = await this.getForDispatch(dispatchId);
    const latest = bills[0];
    if (!latest) {
      throw new LogisticsException('EWAY_BILL_REQUIRED');
    }
    const updated = await this.prisma.eWayBill.update({
      where: { id: latest.id },
      data: { status: EWayBillStatus.CANCELLED },
    });
    await this.events.record(this.prisma, {
      dispatchId,
      eventType: 'EWAY_BILL_CANCELLED',
      actorRole: actor?.role,
      actorUserId: actor?.userId,
      metadata: { ewayBillId: updated.id },
    });
    return updated;
  }

  requireValidForDispatch(bills: EWayBill[]): EWayBill {
    const latest = bills[0];
    if (!latest || !latest.ewayBillNumber) {
      throw new LogisticsException('EWAY_BILL_REQUIRED');
    }
    if (
      latest.status === EWayBillStatus.EXPIRED ||
      (latest.validUntil && latest.validUntil.getTime() < Date.now())
    ) {
      throw new LogisticsException('EWAY_BILL_EXPIRED');
    }
    if (
      latest.status !== EWayBillStatus.VALID &&
      latest.status !== EWayBillStatus.GENERATED &&
      latest.status !== EWayBillStatus.UPLOADED
    ) {
      throw new LogisticsException('EWAY_BILL_INVALID');
    }
    return latest;
  }

  toSellerView(e: EWayBill) {
    return toSellerEwayBill(e);
  }

  toAdminView(e: EWayBill) {
    return toAdminEwayBill(e);
  }
}
