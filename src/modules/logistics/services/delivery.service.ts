import { Injectable } from '@nestjs/common';
import {
  DeliveryExceptionReason,
  DeliveryStatus,
  DocumentCategory,
  PaymentScheduleType,
  Prisma,
  PurchaseOrderStatus,
  ShipmentStatus,
  type Delivery,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { PaymentScheduleService } from '../../payments/services/payment-schedule.service.js';
import { DocumentsCoreService } from '../../documents/services/documents-core.service.js';
import { StorageService } from '../../../storage/storage.service.js';
import { LogisticsException } from '../common/logistics.errors.js';
import { LogisticsEventsService } from '../common/logistics-events.service.js';
import { DeliveryStateService } from '../common/delivery-state.service.js';
import { ShipmentStateService } from '../common/shipment-state.service.js';
import {
  toAdminDelivery,
  toCustomerDelivery,
  toSellerDelivery,
} from '../common/blind-logistics.mapper.js';
import { addQty, cmpQty, round3 } from '../common/quantity.util.js';
import { InvoiceLifecycleService } from './invoice-lifecycle.service.js';

const DELIVERY_INCLUDE = {
  shipment: {
    select: { id: true, referenceNumber: true, status: true },
  },
  purchaseOrder: { select: { referenceNumber: true } },
} satisfies Prisma.DeliveryInclude;

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: LogisticsEventsService,
    private readonly deliveryState: DeliveryStateService,
    private readonly shipmentState: ShipmentStateService,
    private readonly schedules: PaymentScheduleService,
    private readonly invoiceLifecycle: InvoiceLifecycleService,
    private readonly storage: StorageService,
    private readonly documents: DocumentsCoreService,
  ) {}

  async list(params: {
    sellerOrgId?: string;
    customerOrgId?: string;
    skip: number;
    take: number;
    status?: DeliveryStatus;
  }) {
    const where: Prisma.DeliveryWhereInput = {
      ...(params.sellerOrgId ? { sellerOrgId: params.sellerOrgId } : {}),
      ...(params.customerOrgId ? { customerOrgId: params.customerOrgId } : {}),
      ...(params.status ? { status: params.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
        include: DELIVERY_INCLUDE,
      }),
      this.prisma.delivery.count({ where }),
    ]);
    return { items, total };
  }

  async get(
    id: string,
    opts?: { sellerOrgId?: string; customerOrgId?: string },
  ) {
    const delivery = await this.prisma.delivery.findFirst({
      where: {
        id,
        ...(opts?.sellerOrgId ? { sellerOrgId: opts.sellerOrgId } : {}),
        ...(opts?.customerOrgId ? { customerOrgId: opts.customerOrgId } : {}),
      },
      include: DELIVERY_INCLUDE,
    });
    if (!delivery) {
      throw new LogisticsException('DELIVERY_NOT_FOUND');
    }
    return delivery;
  }

  async markDelivered(
    id: string,
    input: {
      deliveredAt?: string;
      receivedBy?: string;
      deliveryNote?: string;
      deliveredQuantity?: number;
    },
    opts?: { sellerOrgId?: string; userId?: string; role?: string },
  ) {
    const delivery = await this.get(id, { sellerOrgId: opts?.sellerOrgId });
    const shipment = await this.prisma.shipment.findUniqueOrThrow({
      where: { id: delivery.shipmentId },
    });

    const deliveredQty = round3(
      input.deliveredQuantity ?? shipment.quantity ?? delivery.quantity,
    );
    if (cmpQty(deliveredQty, 0) <= 0) {
      throw new LogisticsException('DELIVERY_QUANTITY_EXCEEDED');
    }
    if (cmpQty(deliveredQty, delivery.quantity) > 0) {
      throw new LogisticsException('DELIVERY_QUANTITY_EXCEEDED');
    }

    const nextDeliveryStatus =
      cmpQty(deliveredQty, delivery.quantity) < 0
        ? DeliveryStatus.PARTIAL
        : DeliveryStatus.DELIVERED;

    this.deliveryState.assertTransition(delivery.status, nextDeliveryStatus);
    if (
      shipment.status !== ShipmentStatus.DELIVERED &&
      shipment.status !== ShipmentStatus.DELIVERY_CONFIRMED
    ) {
      this.shipmentState.assertTransition(
        shipment.status,
        ShipmentStatus.DELIVERED,
      );
    }

    const deliveredAt = input.deliveredAt
      ? new Date(input.deliveredAt)
      : new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedDelivery = await tx.delivery.update({
        where: { id },
        data: {
          status: nextDeliveryStatus,
          deliveredQuantity: deliveredQty,
          deliveredAt,
          receivedBy: input.receivedBy,
          deliveryNote: input.deliveryNote,
        },
        include: DELIVERY_INCLUDE,
      });

      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          status: ShipmentStatus.DELIVERED,
          deliveredAt,
        },
      });

      await tx.shipmentTrackingEvent.create({
        data: {
          shipmentId: shipment.id,
          status: ShipmentStatus.DELIVERED,
          description: 'Marked delivered by seller',
          source: opts?.role ?? 'SELLER',
          createdById: opts?.userId,
          occurredAt: deliveredAt,
        },
      });

      const po = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: delivery.purchaseOrderId },
      });
      const newDelivered = addQty(po.deliveredQuantity, deliveredQty);
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          deliveredQuantity: newDelivered,
          status: PurchaseOrderStatus.DELIVERED,
        },
      });

      await this.schedules.markPaymentMilestoneDue(
        delivery.purchaseOrderId,
        PaymentScheduleType.ON_DELIVERY,
        tx,
      );

      await this.events.record(tx, {
        purchaseOrderId: delivery.purchaseOrderId,
        shipmentId: shipment.id,
        deliveryId: id,
        eventType: 'DELIVERY_MARKED_DELIVERED',
        actorRole: opts?.role,
        actorUserId: opts?.userId,
        metadata: { deliveredQuantity: deliveredQty.toFixed(3) },
      });

      return updatedDelivery;
    });

    await this.invoiceLifecycle.onDeliveryCompleted(result.id);
    return result;
  }

  async confirm(
    id: string,
    opts: { customerOrgId: string; userId?: string; role?: string },
  ) {
    const delivery = await this.get(id, {
      customerOrgId: opts.customerOrgId,
    });

    if (delivery.status === DeliveryStatus.CONFIRMED) {
      throw new LogisticsException('DELIVERY_ALREADY_CONFIRMED');
    }
    if (
      delivery.status !== DeliveryStatus.DELIVERED &&
      delivery.status !== DeliveryStatus.PARTIAL
    ) {
      throw new LogisticsException(
        'INVALID_DELIVERY_TRANSITION',
        'Delivery must be marked delivered before confirmation',
      );
    }

    this.deliveryState.assertTransition(
      delivery.status,
      DeliveryStatus.CONFIRMED,
    );

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.delivery.update({
        where: { id },
        data: {
          status: DeliveryStatus.CONFIRMED,
          confirmedAt: now,
        },
        include: DELIVERY_INCLUDE,
      });

      const shipment = await tx.shipment.findUniqueOrThrow({
        where: { id: delivery.shipmentId },
      });
      this.shipmentState.assertTransition(
        shipment.status,
        ShipmentStatus.DELIVERY_CONFIRMED,
      );
      await tx.shipment.update({
        where: { id: shipment.id },
        data: { status: ShipmentStatus.DELIVERY_CONFIRMED },
      });

      await tx.shipmentTrackingEvent.create({
        data: {
          shipmentId: shipment.id,
          status: ShipmentStatus.DELIVERY_CONFIRMED,
          description: 'Delivery confirmed by customer',
          source: 'CUSTOMER',
          createdById: opts.userId,
          occurredAt: now,
        },
      });

      await this.events.record(tx, {
        purchaseOrderId: delivery.purchaseOrderId,
        shipmentId: shipment.id,
        deliveryId: id,
        eventType: 'DELIVERY_CONFIRMED',
        actorRole: opts.role ?? 'CUSTOMER',
        actorUserId: opts.userId,
      });

      return updated;
    });
  }

  async uploadPod(
    id: string,
    input: { documentKey: string; documentId?: string },
    opts?: {
      sellerOrgId?: string;
      customerOrgId?: string;
      userId?: string;
      role?: string;
    },
  ) {
    await this.get(id, {
      sellerOrgId: opts?.sellerOrgId,
      customerOrgId: opts?.customerOrgId,
    });

    if (input.documentId) {
      await this.documents.assertDocumentCategory(
        input.documentId,
        DocumentCategory.POD,
      );
    }

    const updated = await this.prisma.delivery.update({
      where: { id },
      data: {
        podDocumentKey: input.documentKey,
        podDocumentId: input.documentId,
      },
      include: DELIVERY_INCLUDE,
    });
    await this.events.record(this.prisma, {
      purchaseOrderId: updated.purchaseOrderId,
      deliveryId: id,
      eventType: 'POD_UPLOADED',
      actorRole: opts?.role,
      actorUserId: opts?.userId,
      metadata: {
        documentKey: input.documentKey,
        documentId: input.documentId ?? null,
      },
    });
    return updated;
  }

  async getPodSignedUrl(
    id: string,
    opts?: { sellerOrgId?: string; customerOrgId?: string },
  ) {
    const delivery = await this.get(id, opts);
    if (!delivery.podDocumentKey) {
      throw new LogisticsException(
        'DELIVERY_NOT_FOUND',
        'POD document not uploaded',
      );
    }
    if (!this.storage.isConfigured()) {
      return { documentKey: delivery.podDocumentKey, url: null };
    }
    const url = await this.storage.getSignedUrl({
      key: delivery.podDocumentKey,
      expiresInSeconds: 900,
    });
    return { documentKey: delivery.podDocumentKey, url };
  }

  async markException(
    id: string,
    input: {
      reason: DeliveryExceptionReason;
      note?: string;
    },
    opts?: { userId?: string; role?: string },
  ) {
    const delivery = await this.get(id);
    this.deliveryState.assertTransition(
      delivery.status,
      DeliveryStatus.EXCEPTION,
    );

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.delivery.update({
        where: { id },
        data: {
          status: DeliveryStatus.EXCEPTION,
          exceptionReason: input.reason,
          exceptionNote: input.note,
          exceptionAt: now,
        },
        include: DELIVERY_INCLUDE,
      });

      await tx.shipment.update({
        where: { id: delivery.shipmentId },
        data: { status: ShipmentStatus.EXCEPTION },
      });

      await this.events.record(tx, {
        purchaseOrderId: delivery.purchaseOrderId,
        shipmentId: delivery.shipmentId,
        deliveryId: id,
        eventType: 'DELIVERY_EXCEPTION_CREATED',
        actorRole: opts?.role,
        actorUserId: opts?.userId,
        metadata: { reason: input.reason, note: input.note },
      });

      return updated;
    });
  }

  async resolveException(
    id: string,
    opts?: { userId?: string; role?: string },
  ) {
    const delivery = await this.get(id);
    if (delivery.status !== DeliveryStatus.EXCEPTION) {
      throw new LogisticsException('INVALID_DELIVERY_TRANSITION');
    }
    const updated = await this.prisma.delivery.update({
      where: { id },
      data: {
        status: DeliveryStatus.SCHEDULED,
        resolvedAt: new Date(),
        resolvedById: opts?.userId,
        exceptionReason: null,
        exceptionNote: null,
      },
      include: DELIVERY_INCLUDE,
    });
    await this.events.record(this.prisma, {
      purchaseOrderId: delivery.purchaseOrderId,
      deliveryId: id,
      eventType: 'DELIVERY_EXCEPTION_RESOLVED',
      actorRole: opts?.role,
      actorUserId: opts?.userId,
    });
    return updated;
  }

  toCustomerView(d: Delivery) {
    return toCustomerDelivery(d as never);
  }

  toSellerView(d: Delivery) {
    return toSellerDelivery(d as never);
  }

  toAdminView(d: Delivery) {
    return toAdminDelivery(d as never);
  }
}
