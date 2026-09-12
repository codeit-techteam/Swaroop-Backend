import { Injectable } from '@nestjs/common';
import {
  DeliveryStatus,
  Prisma,
  ShipmentStatus,
  type Shipment,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { LogisticsException } from '../common/logistics.errors.js';
import { LogisticsEventsService } from '../common/logistics-events.service.js';
import { ShipmentStateService } from '../common/shipment-state.service.js';
import {
  toAdminShipment,
  toCustomerShipment,
  toSellerShipment,
} from '../common/blind-logistics.mapper.js';

const SHIPMENT_INCLUDE = {
  purchaseOrder: { select: { referenceNumber: true, status: true } },
  dispatch: { select: { dispatchNumber: true, status: true } },
  trackingEvents: { orderBy: { occurredAt: 'asc' as const } },
  delivery: true,
  items: true,
} satisfies Prisma.ShipmentInclude;

@Injectable()
export class ShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: LogisticsEventsService,
    private readonly shipmentState: ShipmentStateService,
  ) {}

  async list(params: {
    sellerOrgId?: string;
    customerOrgId?: string;
    skip: number;
    take: number;
    status?: ShipmentStatus;
  }) {
    const where: Prisma.ShipmentWhereInput = {
      deletedAt: null,
      ...(params.sellerOrgId ? { sellerOrgId: params.sellerOrgId } : {}),
      ...(params.customerOrgId ? { customerOrgId: params.customerOrgId } : {}),
      ...(params.status ? { status: params.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
        include: SHIPMENT_INCLUDE,
      }),
      this.prisma.shipment.count({ where }),
    ]);
    return { items, total };
  }

  async get(
    id: string,
    opts?: { sellerOrgId?: string; customerOrgId?: string },
  ) {
    const shipment = await this.prisma.shipment.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(opts?.sellerOrgId ? { sellerOrgId: opts.sellerOrgId } : {}),
        ...(opts?.customerOrgId ? { customerOrgId: opts.customerOrgId } : {}),
      },
      include: SHIPMENT_INCLUDE,
    });
    if (!shipment) {
      throw new LogisticsException('SHIPMENT_NOT_FOUND');
    }
    return shipment;
  }

  async addTrackingEvent(
    shipmentId: string,
    input: {
      status: ShipmentStatus;
      location?: string;
      notes?: string;
      description?: string;
      occurredAt?: string;
    },
    opts?: { sellerOrgId?: string; userId?: string; role?: string },
  ) {
    const shipment = await this.get(shipmentId, {
      sellerOrgId: opts?.sellerOrgId,
    });

    this.shipmentState.assertTrackingTransition(shipment.status, input.status);

    const occurredAt = input.occurredAt
      ? new Date(input.occurredAt)
      : new Date();

    return this.prisma.$transaction(async (tx) => {
      const event = await tx.shipmentTrackingEvent.create({
        data: {
          shipmentId,
          status: input.status,
          location: input.location,
          notes: input.notes,
          description: input.description,
          source: opts?.role ?? 'SELLER',
          createdById: opts?.userId,
          occurredAt,
        },
      });

      const updated = await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          status: input.status,
          ...(input.status === ShipmentStatus.DELIVERED
            ? { deliveredAt: occurredAt }
            : {}),
        },
        include: SHIPMENT_INCLUDE,
      });

      if (
        input.status === ShipmentStatus.OUT_FOR_DELIVERY &&
        updated.delivery
      ) {
        await tx.delivery.update({
          where: { id: updated.delivery.id },
          data: { status: DeliveryStatus.OUT_FOR_DELIVERY },
        });
      }

      // Tracking DELIVERED does not auto-confirm delivery — seller mark-delivered does.

      await this.events.record(tx, {
        purchaseOrderId: shipment.purchaseOrderId,
        shipmentId,
        eventType: `TRACKING_${input.status}`,
        actorRole: opts?.role,
        actorUserId: opts?.userId,
        metadata: { location: input.location },
      });

      return { shipment: updated, event };
    });
  }

  async updateEta(
    shipmentId: string,
    eta: string,
    opts?: { sellerOrgId?: string; userId?: string; role?: string },
  ) {
    await this.get(shipmentId, { sellerOrgId: opts?.sellerOrgId });
    const updated = await this.prisma.shipment.update({
      where: { id: shipmentId },
      data: { eta: new Date(eta) },
      include: SHIPMENT_INCLUDE,
    });
    await this.events.record(this.prisma, {
      purchaseOrderId: updated.purchaseOrderId,
      shipmentId,
      eventType: 'ETA_UPDATED',
      actorRole: opts?.role,
      actorUserId: opts?.userId,
      metadata: { eta },
    });
    return updated;
  }

  toCustomerView(s: Shipment) {
    return toCustomerShipment(s as never);
  }

  toSellerView(s: Shipment) {
    return toSellerShipment(s as never);
  }

  toAdminView(s: Shipment) {
    return toAdminShipment(s as never);
  }
}
