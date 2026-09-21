import { Injectable } from '@nestjs/common';
import {
  DeliveryStatus,
  DispatchStatus,
  InventoryStatus,
  PaymentScheduleType,
  Prisma,
  PurchaseOrderStatus,
  ShipmentStatus,
  StockMovementType,
  VehicleOperationalStatus,
  type Dispatch,
} from '../../../generated/prisma/client.js';
import { REFERENCE_NUMBER_PREFIX } from '../../../common/enums/domain.enums.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { DispatchGateService } from '../../payments/services/dispatch-gate.service.js';
import { PaymentScheduleService } from '../../payments/services/payment-schedule.service.js';
import { CreditLedgerService } from '../../payments/services/credit-ledger.service.js';
import { isPlatformCredit } from '../../payments/common/platform-credit.js';
import { LogisticsException } from '../common/logistics.errors.js';
import { LogisticsEventsService } from '../common/logistics-events.service.js';
import { DispatchStateService } from '../common/dispatch-state.service.js';
import {
  toAdminDispatch,
  toSellerDispatch,
} from '../common/blind-logistics.mapper.js';
import { addQty, cmpQty, toQty } from '../common/quantity.util.js';
import { QuantityService } from './quantity.service.js';
import { VehicleService } from './vehicle.service.js';
import { DriverService } from './driver.service.js';
import { EwayBillService } from './eway-bill.service.js';
import { InvoiceLifecycleService } from './invoice-lifecycle.service.js';

export type CreateDispatchInput = {
  purchaseOrderId: string;
  quantity: number;
  plannedDispatchDate?: string;
  originWarehouseId?: string;
  destinationRegion?: string;
  idempotencyKey?: string;
};

const DISPATCH_INCLUDE = {
  purchaseOrder: { select: { referenceNumber: true, status: true } },
  ewayBills: { orderBy: { createdAt: 'desc' as const } },
  shipments: { select: { id: true } },
} satisfies Prisma.DispatchInclude;

@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quantity: QuantityService,
    private readonly gate: DispatchGateService,
    private readonly schedules: PaymentScheduleService,
    private readonly events: LogisticsEventsService,
    private readonly dispatchState: DispatchStateService,
    private readonly vehicles: VehicleService,
    private readonly drivers: DriverService,
    private readonly eway: EwayBillService,
    private readonly invoiceLifecycle: InvoiceLifecycleService,
    private readonly creditLedger: CreditLedgerService,
  ) {}

  nextDispatchNumber(now = new Date()): string {
    const year = now.getFullYear();
    const seq = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0');
    return `DSP-${year}-${seq}`;
  }

  nextShipmentNumber(now = new Date()): string {
    const year = now.getFullYear();
    const seq = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0');
    return `${REFERENCE_NUMBER_PREFIX.SHIPMENT}-${year}-${seq}`;
  }

  async create(
    sellerOrgId: string,
    input: CreateDispatchInput,
    actor?: { userId?: string; role?: string },
  ) {
    if (input.idempotencyKey) {
      const existing = await this.prisma.dispatch.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: DISPATCH_INCLUDE,
      });
      if (existing) {
        if (existing.sellerOrgId !== sellerOrgId) {
          throw new LogisticsException('IDEMPOTENCY_CONFLICT');
        }
        return existing;
      }
    }

    const po = await this.prisma.purchaseOrder.findFirst({
      where: {
        id: input.purchaseOrderId,
        sellerOrgId,
        deletedAt: null,
      },
    });
    if (!po) {
      throw new LogisticsException('PO_NOT_FOUND');
    }

    const eligible: PurchaseOrderStatus[] = [
      PurchaseOrderStatus.CONFIRMED,
      PurchaseOrderStatus.READY_FOR_DISPATCH,
      PurchaseOrderStatus.DISPATCHED,
    ];
    if (!eligible.includes(po.status)) {
      throw new LogisticsException('PO_NOT_ELIGIBLE_FOR_DISPATCH');
    }

    const clearance = await this.gate.checkForPurchaseOrder(po.id, {
      sellerOrgId,
    });
    if (!clearance.cleared) {
      throw new LogisticsException('PAYMENT_NOT_CLEARED');
    }

    const check = this.quantity.assertDispatchQuantity(po, input.quantity);
    if (!check.ok) {
      throw new LogisticsException('DISPATCH_QUANTITY_EXCEEDED');
    }

    // Soft inventory check — only fail when inventory row exists and is short.
    const productId = this.quantity.productIdFromPo(po);
    if (productId) {
      const invRows = await this.prisma.inventory.findMany({
        where: {
          organizationId: sellerOrgId,
          productId,
          deletedAt: null,
        },
      });
      if (invRows.length > 0) {
        const available = invRows.reduce(
          (sum, row) => addQty(sum, row.availableQty),
          toQty(0),
        );
        if (cmpQty(available, check.qty) < 0) {
          throw new LogisticsException('INSUFFICIENT_INVENTORY');
        }
      }
    }

    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const dispatch = await this.prisma.$transaction(async (tx) => {
          const created = await tx.dispatch.create({
            data: {
              dispatchNumber: this.nextDispatchNumber(),
              purchaseOrderId: po.id,
              sellerOrgId: po.sellerOrgId,
              customerOrgId: po.customerOrgId,
              status: DispatchStatus.AWAITING_VEHICLE,
              quantity: check.qty,
              unit: 'MT',
              plannedDispatchDate: input.plannedDispatchDate
                ? new Date(input.plannedDispatchDate)
                : undefined,
              originWarehouseId: input.originWarehouseId,
              destinationRegion: input.destinationRegion,
              destinationSnapshot: input.destinationRegion
                ? ({ region: input.destinationRegion } as Prisma.InputJsonValue)
                : undefined,
              createdById: actor?.userId,
              idempotencyKey: input.idempotencyKey,
              metadata: {
                initialStatus: DispatchStatus.PLANNED,
              } as Prisma.InputJsonValue,
            },
            include: DISPATCH_INCLUDE,
          });

          await this.events.record(tx, {
            purchaseOrderId: po.id,
            dispatchId: created.id,
            eventType: 'DISPATCH_CREATED',
            actorRole: actor?.role,
            actorUserId: actor?.userId,
            metadata: { quantity: check.qty.toFixed(3) },
          });

          if (po.status === PurchaseOrderStatus.CONFIRMED) {
            await tx.purchaseOrder.update({
              where: { id: po.id },
              data: { status: PurchaseOrderStatus.READY_FOR_DISPATCH },
            });
          }

          if (productId) {
            await this.applyInventoryDispatch(
              tx,
              sellerOrgId,
              productId,
              check.qty,
              created.id,
            );
          }

          if (isPlatformCredit(po.paymentMethod)) {
            await this.creditLedger.utilizeReservedCredit(tx, {
              customerOrgId: po.customerOrgId,
              purchaseOrderId: po.id,
              amount: po.totalAmount,
              actorUserId: actor?.userId,
            });
          }

          return created;
        });
        return dispatch;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          if (input.idempotencyKey) {
            const raced = await this.prisma.dispatch.findUnique({
              where: { idempotencyKey: input.idempotencyKey },
              include: DISPATCH_INCLUDE,
            });
            if (raced) return raced;
          }
          continue;
        }
        throw err;
      }
    }
    throw new Error('Failed to create dispatch');
  }

  async list(params: {
    sellerOrgId?: string;
    customerOrgId?: string;
    skip: number;
    take: number;
    status?: DispatchStatus;
  }) {
    const where: Prisma.DispatchWhereInput = {
      deletedAt: null,
      ...(params.sellerOrgId ? { sellerOrgId: params.sellerOrgId } : {}),
      ...(params.customerOrgId ? { customerOrgId: params.customerOrgId } : {}),
      ...(params.status ? { status: params.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.dispatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
        include: DISPATCH_INCLUDE,
      }),
      this.prisma.dispatch.count({ where }),
    ]);
    return { items, total };
  }

  async get(
    id: string,
    opts?: { sellerOrgId?: string; customerOrgId?: string },
  ) {
    const dispatch = await this.prisma.dispatch.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(opts?.sellerOrgId ? { sellerOrgId: opts.sellerOrgId } : {}),
        ...(opts?.customerOrgId ? { customerOrgId: opts.customerOrgId } : {}),
      },
      include: DISPATCH_INCLUDE,
    });
    if (!dispatch) {
      throw new LogisticsException('DISPATCH_NOT_FOUND');
    }
    return dispatch;
  }

  async assignVehicle(
    dispatchId: string,
    input: { vehicleId: string; driverId?: string },
    opts?: { sellerOrgId?: string; userId?: string; role?: string },
  ) {
    const dispatch = await this.get(dispatchId, {
      sellerOrgId: opts?.sellerOrgId,
    });

    if (
      dispatch.status !== DispatchStatus.AWAITING_VEHICLE &&
      dispatch.status !== DispatchStatus.VEHICLE_ASSIGNED &&
      dispatch.status !== DispatchStatus.AWAITING_EWAY_BILL &&
      dispatch.status !== DispatchStatus.PLANNED
    ) {
      throw new LogisticsException(
        'INVALID_DISPATCH_TRANSITION',
        `Cannot assign vehicle in status ${dispatch.status}`,
      );
    }

    const vehicle = await this.vehicles.requireVehicle(
      input.vehicleId,
      opts?.sellerOrgId,
    );
    this.vehicles.assertAssignable(vehicle, dispatch.quantity);

    const activeOnVehicle = await this.prisma.dispatch.findFirst({
      where: {
        vehicleId: vehicle.id,
        deletedAt: null,
        id: { not: dispatchId },
        status: {
          notIn: [DispatchStatus.DISPATCHED, DispatchStatus.CANCELLED],
        },
      },
    });
    if (activeOnVehicle) {
      throw new LogisticsException('VEHICLE_ALREADY_ASSIGNED');
    }

    const driverId = input.driverId ?? vehicle.driverId ?? undefined;
    if (driverId) {
      const driver = await this.drivers.requireDriver(
        driverId,
        opts?.sellerOrgId,
      );
      this.drivers.assertAssignable(driver);
    }

    // Normalize toward AWAITING_EWAY_BILL after assignment
    let workingStatus = dispatch.status;
    if (workingStatus === DispatchStatus.PLANNED) {
      this.dispatchState.assertTransition(
        workingStatus,
        DispatchStatus.AWAITING_VEHICLE,
      );
      workingStatus = DispatchStatus.AWAITING_VEHICLE;
    }

    if (workingStatus === DispatchStatus.AWAITING_VEHICLE) {
      this.dispatchState.assertTransition(
        workingStatus,
        DispatchStatus.VEHICLE_ASSIGNED,
      );
      workingStatus = DispatchStatus.VEHICLE_ASSIGNED;
    }

    if (workingStatus === DispatchStatus.VEHICLE_ASSIGNED) {
      this.dispatchState.assertTransition(
        workingStatus,
        DispatchStatus.AWAITING_EWAY_BILL,
      );
      workingStatus = DispatchStatus.AWAITING_EWAY_BILL;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.vehicle.update({
        where: { id: vehicle.id },
        data: {
          status: VehicleOperationalStatus.ASSIGNED,
          ...(driverId ? { driverId } : {}),
        },
      });

      const row = await tx.dispatch.update({
        where: { id: dispatchId },
        data: {
          vehicleId: vehicle.id,
          driverId: driverId ?? null,
          status: workingStatus,
        },
        include: DISPATCH_INCLUDE,
      });

      await this.events.record(tx, {
        purchaseOrderId: dispatch.purchaseOrderId,
        dispatchId,
        eventType: 'VEHICLE_ASSIGNED',
        actorRole: opts?.role,
        actorUserId: opts?.userId,
        metadata: { vehicleId: vehicle.id, driverId },
      });

      return row;
    });

    return updated;
  }

  async startLoading(
    dispatchId: string,
    opts?: { sellerOrgId?: string; userId?: string; role?: string },
  ) {
    const dispatch = await this.get(dispatchId, {
      sellerOrgId: opts?.sellerOrgId,
    });
    this.dispatchState.assertTransition(
      dispatch.status,
      DispatchStatus.LOADING,
    );

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.dispatch.update({
        where: { id: dispatchId },
        data: {
          status: DispatchStatus.LOADING,
          loadingStartedAt: new Date(),
        },
        include: DISPATCH_INCLUDE,
      });

      await this.schedules.markPaymentMilestoneDue(
        dispatch.purchaseOrderId,
        PaymentScheduleType.ON_LOADING,
        tx,
      );

      await this.events.record(tx, {
        purchaseOrderId: dispatch.purchaseOrderId,
        dispatchId,
        eventType: 'LOADING_STARTED',
        actorRole: opts?.role,
        actorUserId: opts?.userId,
      });

      return updated;
    });
  }

  async completeLoading(
    dispatchId: string,
    opts?: { sellerOrgId?: string; userId?: string; role?: string },
  ) {
    const dispatch = await this.get(dispatchId, {
      sellerOrgId: opts?.sellerOrgId,
    });
    this.dispatchState.assertTransition(dispatch.status, DispatchStatus.LOADED);

    const updated = await this.prisma.dispatch.update({
      where: { id: dispatchId },
      data: {
        status: DispatchStatus.LOADED,
        loadingCompletedAt: new Date(),
      },
      include: DISPATCH_INCLUDE,
    });

    await this.events.record(this.prisma, {
      purchaseOrderId: dispatch.purchaseOrderId,
      dispatchId,
      eventType: 'LOADING_COMPLETED',
      actorRole: opts?.role,
      actorUserId: opts?.userId,
    });

    return updated;
  }

  async markReady(
    dispatchId: string,
    opts?: { sellerOrgId?: string; userId?: string; role?: string },
  ) {
    const dispatch = await this.get(dispatchId, {
      sellerOrgId: opts?.sellerOrgId,
    });
    this.dispatchState.assertTransition(
      dispatch.status,
      DispatchStatus.READY_FOR_DISPATCH,
    );
    const bills = await this.eway.getForDispatch(dispatchId);
    this.eway.requireValidForDispatch(bills);

    const updated = await this.prisma.dispatch.update({
      where: { id: dispatchId },
      data: { status: DispatchStatus.READY_FOR_DISPATCH },
      include: DISPATCH_INCLUDE,
    });

    await this.events.record(this.prisma, {
      purchaseOrderId: dispatch.purchaseOrderId,
      dispatchId,
      eventType: 'DISPATCH_READY',
      actorRole: opts?.role,
      actorUserId: opts?.userId,
    });

    return updated;
  }

  async executeDispatch(
    dispatchId: string,
    opts?: { sellerOrgId?: string; userId?: string; role?: string },
  ) {
    const dispatch = await this.get(dispatchId, {
      sellerOrgId: opts?.sellerOrgId,
    });

    if (
      dispatch.status !== DispatchStatus.READY_FOR_DISPATCH &&
      dispatch.status !== DispatchStatus.LOADED
    ) {
      throw new LogisticsException(
        'INVALID_DISPATCH_TRANSITION',
        `Cannot execute dispatch in status ${dispatch.status}`,
      );
    }

    if (!dispatch.vehicleId) {
      throw new LogisticsException('VEHICLE_NOT_FOUND', 'Vehicle not assigned');
    }

    const bills = await this.eway.getForDispatch(dispatchId);
    const eway = this.eway.requireValidForDispatch(bills);

    const existingShipment = await this.prisma.shipment.findUnique({
      where: { dispatchId },
    });
    if (existingShipment) {
      throw new LogisticsException('SHIPMENT_ALREADY_CREATED');
    }

    this.dispatchState.assertTransition(
      dispatch.status,
      DispatchStatus.DISPATCHED,
    );

    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      let shipment;
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          shipment = await tx.shipment.create({
            data: {
              referenceNumber: this.nextShipmentNumber(now),
              purchaseOrderId: dispatch.purchaseOrderId,
              dispatchId: dispatch.id,
              customerOrgId: dispatch.customerOrgId,
              sellerOrgId: dispatch.sellerOrgId,
              originWarehouseId: dispatch.originWarehouseId,
              vehicleId: dispatch.vehicleId,
              driverId: dispatch.driverId,
              quantity: dispatch.quantity,
              unit: dispatch.unit,
              status: ShipmentStatus.DISPATCHED,
              dispatchedAt: now,
              ewayBillNumber: eway.ewayBillNumber,
              destinationSnapshot: dispatch.destinationSnapshot ?? undefined,
              items: {
                create: [
                  {
                    quantity: dispatch.quantity,
                    unit: dispatch.unit,
                  },
                ],
              },
              trackingEvents: {
                create: [
                  {
                    status: ShipmentStatus.DISPATCHED,
                    description: 'Shipment dispatched',
                    source: 'SYSTEM',
                    createdById: opts?.userId,
                    occurredAt: now,
                  },
                ],
              },
            },
          });
          break;
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            continue;
          }
          throw err;
        }
      }
      if (!shipment) {
        throw new Error('Failed to create shipment');
      }

      const delivery = await tx.delivery.create({
        data: {
          shipmentId: shipment.id,
          purchaseOrderId: dispatch.purchaseOrderId,
          customerOrgId: dispatch.customerOrgId,
          sellerOrgId: dispatch.sellerOrgId,
          status: DeliveryStatus.SCHEDULED,
          quantity: dispatch.quantity,
          unit: dispatch.unit,
        },
      });

      const updatedDispatch = await tx.dispatch.update({
        where: { id: dispatchId },
        data: {
          status: DispatchStatus.DISPATCHED,
          actualDispatchDate: now,
        },
        include: DISPATCH_INCLUDE,
      });

      const po = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: dispatch.purchaseOrderId },
      });
      const newDispatched = addQty(po.dispatchedQuantity, dispatch.quantity);
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          dispatchedQuantity: newDispatched,
          status: PurchaseOrderStatus.DISPATCHED,
        },
      });

      await tx.vehicle.update({
        where: { id: dispatch.vehicleId! },
        data: { status: VehicleOperationalStatus.IN_TRANSIT },
      });

      await this.events.record(tx, {
        purchaseOrderId: dispatch.purchaseOrderId,
        dispatchId,
        shipmentId: shipment.id,
        deliveryId: delivery.id,
        eventType: 'DISPATCHED',
        actorRole: opts?.role,
        actorUserId: opts?.userId,
      });
      await this.events.record(tx, {
        purchaseOrderId: dispatch.purchaseOrderId,
        shipmentId: shipment.id,
        deliveryId: delivery.id,
        eventType: 'DELIVERY_CREATED',
        actorRole: opts?.role,
        actorUserId: opts?.userId,
      });

      return { dispatch: updatedDispatch, shipment, delivery };
    });

    await this.invoiceLifecycle.onShipmentDispatched(result.shipment.id);
    return result;
  }

  async cancel(
    dispatchId: string,
    opts?: { sellerOrgId?: string; userId?: string; role?: string },
  ) {
    const dispatch = await this.get(dispatchId, {
      sellerOrgId: opts?.sellerOrgId,
    });
    this.dispatchState.assertTransition(
      dispatch.status,
      DispatchStatus.CANCELLED,
    );
    const updated = await this.prisma.dispatch.update({
      where: { id: dispatchId },
      data: { status: DispatchStatus.CANCELLED },
      include: DISPATCH_INCLUDE,
    });
    await this.events.record(this.prisma, {
      purchaseOrderId: dispatch.purchaseOrderId,
      dispatchId,
      eventType: 'DISPATCH_CANCELLED',
      actorRole: opts?.role,
      actorUserId: opts?.userId,
    });
    return updated;
  }

  private async applyInventoryDispatch(
    tx: Prisma.TransactionClient,
    sellerOrgId: string,
    productId: string,
    quantity: Prisma.Decimal,
    dispatchId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM inventory
      WHERE organization_id = ${sellerOrgId}::uuid
        AND product_id = ${productId}::uuid
        AND deleted_at IS NULL
      FOR UPDATE
    `;
    if (rows.length === 0) return;

    let remaining = toQty(quantity);
    for (const row of rows) {
      if (cmpQty(remaining, 0) <= 0) break;
      const current = await tx.inventory.findUnique({ where: { id: row.id } });
      if (!current) continue;
      const available = toQty(current.availableQty);
      if (cmpQty(available, 0) <= 0) continue;
      const take = cmpQty(available, remaining) <= 0 ? available : remaining;
      const nextAvailable = toQty(available.minus(take));
      const nextSold = toQty(current.soldQty).plus(take);
      await tx.inventory.update({
        where: { id: row.id },
        data: {
          availableQty: nextAvailable,
          soldQty: nextSold,
          status:
            cmpQty(nextAvailable, 0) <= 0
              ? InventoryStatus.OUT_OF_STOCK
              : current.status,
        },
      });
      await tx.stockMovement.create({
        data: {
          inventoryId: row.id,
          type: StockMovementType.DISPATCH,
          quantity: take,
          unit: current.unit,
          referenceType: 'DISPATCH',
          referenceId: dispatchId,
          notes: 'Stock deducted on dispatch',
        },
      });
      remaining = toQty(remaining.minus(take));
    }
    if (cmpQty(remaining, 0) > 0) {
      throw new LogisticsException('INSUFFICIENT_INVENTORY');
    }
  }

  toSellerView(d: Dispatch) {
    return toSellerDispatch(d as never);
  }

  toAdminView(d: Dispatch) {
    return toAdminDispatch(d as never);
  }
}
