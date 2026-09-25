import { Injectable } from '@nestjs/common';
import {
  DispatchStatus,
  Prisma,
  VehicleSlotStatus,
  VehicleType,
  type VehicleSlot,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { DispatchGateService } from '../../payments/services/dispatch-gate.service.js';
import { LogisticsException } from '../common/logistics.errors.js';
import { LogisticsEventsService } from '../common/logistics-events.service.js';
import { toSellerVehicleSlot } from '../common/blind-logistics.mapper.js';
import { cmpQty, toQty } from '../common/quantity.util.js';
import {
  ACTIVE_SLOT_STATUSES,
  DEFAULT_LOADING_BAYS,
  DEFAULT_TIME_WINDOWS,
} from '../common/vehicle-slot.constants.js';
import { VehicleService } from './vehicle.service.js';
import { DriverService } from './driver.service.js';

export type CreateSlotInput = {
  warehouseId: string;
  dispatchId?: string;
  vehicleId?: string;
  driverId?: string;
  slotDate: string;
  startTime?: string;
  endTime?: string;
  timeSlot?: string;
  loadingBay?: string;
  quantityMt?: number;
};

export type VehicleSlotListParams = {
  sellerOrgId?: string;
  skip: number;
  take: number;
  status?: VehicleSlotStatus;
  warehouseId?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  vehicleType?: VehicleType;
  carrier?: string;
  orderId?: string;
  dispatchId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
};

const SLOT_INCLUDE = {
  warehouse: {
    select: {
      id: true,
      code: true,
      name: true,
      city: true,
      state: true,
      metadata: true,
    },
  },
  vehicle: {
    select: {
      id: true,
      numberPlate: true,
      type: true,
      transporterName: true,
      driverName: true,
      driverPhone: true,
      driverId: true,
      capacityMt: true,
      status: true,
      driver: {
        select: {
          id: true,
          name: true,
          phone: true,
          status: true,
          licenseExpiry: true,
        },
      },
    },
  },
  dispatch: {
    select: {
      id: true,
      dispatchNumber: true,
      purchaseOrderId: true,
      sellerOrgId: true,
      customerOrgId: true,
      status: true,
      quantity: true,
      unit: true,
      originWarehouseId: true,
      destinationRegion: true,
      vehicleId: true,
      driverId: true,
      purchaseOrder: {
        select: { referenceNumber: true, status: true },
      },
      driver: {
        select: { id: true, name: true, phone: true },
      },
    },
  },
  shipment: {
    select: { id: true, referenceNumber: true, status: true },
  },
} satisfies Prisma.VehicleSlotInclude;

type SlotRow = Prisma.VehicleSlotGetPayload<{ include: typeof SLOT_INCLUDE }>;

function dateOnlyUtc(isoDate: string): Date {
  // Treat YYYY-MM-DD as a calendar date without local TZ shift.
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function resolveTimeWindow(input: CreateSlotInput): {
  timeSlot: string;
  startTime: string;
  endTime: string;
} {
  if (input.timeSlot) {
    const match = DEFAULT_TIME_WINDOWS.find((w) => w.timeSlot === input.timeSlot);
    if (match) {
      return {
        timeSlot: match.timeSlot,
        startTime: input.startTime ?? match.startTime,
        endTime: input.endTime ?? match.endTime,
      };
    }
    if (input.startTime && input.endTime) {
      return {
        timeSlot: input.timeSlot,
        startTime: input.startTime,
        endTime: input.endTime,
      };
    }
    const parts = input.timeSlot.split(/[–-]/).map((p) => p.trim());
    if (parts.length >= 2) {
      return {
        timeSlot: input.timeSlot,
        startTime: input.startTime ?? parts[0]!,
        endTime: input.endTime ?? parts[1]!,
      };
    }
  }
  if (input.startTime && input.endTime) {
    return {
      timeSlot: `${input.startTime}–${input.endTime}`,
      startTime: input.startTime,
      endTime: input.endTime,
    };
  }
  throw new LogisticsException(
    'VEHICLE_SLOT_UNAVAILABLE',
    'Preferred time slot is required',
  );
}

function loadingBaysForWarehouse(metadata: unknown): string[] {
  if (
    metadata &&
    typeof metadata === 'object' &&
    Array.isArray((metadata as { loadingBays?: unknown }).loadingBays)
  ) {
    const bays = (metadata as { loadingBays: unknown[] }).loadingBays
      .map((b) => String(b).trim())
      .filter(Boolean);
    if (bays.length > 0) return bays;
  }
  return [...DEFAULT_LOADING_BAYS];
}

@Injectable()
export class VehicleSlotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: LogisticsEventsService,
    private readonly vehicles: VehicleService,
    private readonly drivers: DriverService,
    private readonly gate: DispatchGateService,
  ) {}

  nextSlotNumber(now = new Date()): string {
    const year = now.getFullYear();
    const seq = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0');
    return `VS-${year}-${seq}`;
  }

  async create(
    input: CreateSlotInput,
    actor?: { userId?: string; role?: string; sellerOrgId?: string },
  ): Promise<SlotRow> {
    const window = resolveTimeWindow(input);
    if (!input.loadingBay?.trim()) {
      throw new LogisticsException(
        'VEHICLE_SLOT_UNAVAILABLE',
        'Loading bay is required',
      );
    }
    const loadingBay = input.loadingBay.trim();
    const slotDate = dateOnlyUtc(input.slotDate);

    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const slot = await this.prisma.$transaction(async (tx) => {
          const warehouse = await tx.warehouse.findFirst({
            where: { id: input.warehouseId, deletedAt: null, isActive: true },
          });
          if (!warehouse) {
            throw new LogisticsException(
              'VEHICLE_SLOT_NOT_FOUND',
              'Warehouse not found',
            );
          }

          let dispatch: Awaited<
            ReturnType<typeof tx.dispatch.findFirst>
          > | null = null;

          if (input.dispatchId) {
            dispatch = await tx.dispatch.findFirst({
              where: {
                id: input.dispatchId,
                deletedAt: null,
                ...(actor?.sellerOrgId
                  ? { sellerOrgId: actor.sellerOrgId }
                  : {}),
              },
            });
            if (!dispatch) {
              throw new LogisticsException('DISPATCH_NOT_FOUND');
            }
            if (dispatch.status === DispatchStatus.CANCELLED) {
              throw new LogisticsException(
                'VEHICLE_SLOT_UNAVAILABLE',
                'Dispatch is cancelled',
              );
            }
            const eligibleStatuses: DispatchStatus[] = [
              DispatchStatus.DRAFT,
              DispatchStatus.PLANNED,
              DispatchStatus.AWAITING_VEHICLE,
              DispatchStatus.VEHICLE_ASSIGNED,
              DispatchStatus.AWAITING_EWAY_BILL,
              DispatchStatus.READY_FOR_DISPATCH,
            ];
            if (!eligibleStatuses.includes(dispatch.status)) {
              throw new LogisticsException(
                'VEHICLE_SLOT_UNAVAILABLE',
                'Dispatch is not eligible for vehicle slot booking',
              );
            }

            const clearance = await this.gate.checkForPurchaseOrder(
              dispatch.purchaseOrderId,
              { sellerOrgId: dispatch.sellerOrgId },
            );
            if (!clearance.cleared) {
              throw new LogisticsException(
                'PAYMENT_NOT_CLEARED',
                'Vehicle slot booking is not available until the required payment condition is cleared.',
              );
            }

            const existingActive = await tx.vehicleSlot.findFirst({
              where: {
                dispatchId: dispatch.id,
                status: { in: [...ACTIVE_SLOT_STATUSES] },
              },
            });
            if (existingActive) {
              throw new LogisticsException(
                'VEHICLE_SLOT_UNAVAILABLE',
                'This dispatch already has an active vehicle slot',
              );
            }

            if (input.quantityMt != null) {
              if (cmpQty(toQty(input.quantityMt), dispatch.quantity) > 0) {
                throw new LogisticsException(
                  'DISPATCH_QUANTITY_EXCEEDED',
                  'Requested quantity exceeds dispatch quantity',
                );
              }
            }
          } else if (actor?.sellerOrgId) {
            throw new LogisticsException(
              'DISPATCH_NOT_FOUND',
              'Dispatch is required to book a vehicle slot',
            );
          }

          if (input.vehicleId) {
            const vehicle = await this.vehicles.requireVehicle(
              input.vehicleId,
              actor?.sellerOrgId,
            );
            this.vehicles.assertAssignable(
              vehicle,
              input.quantityMt ?? dispatch?.quantity ?? 0.001,
            );

            const vehicleConflict = await tx.vehicleSlot.findFirst({
              where: {
                vehicleId: vehicle.id,
                slotDate,
                timeSlot: window.timeSlot,
                status: { in: [...ACTIVE_SLOT_STATUSES] },
              },
            });
            if (vehicleConflict) {
              throw new LogisticsException(
                'VEHICLE_SLOT_UNAVAILABLE',
                'This slot is no longer available. Please select another slot.',
              );
            }
          }

          let resolvedDriverId = input.driverId;
          if (resolvedDriverId) {
            const driver = await this.drivers.requireDriver(
              resolvedDriverId,
              actor?.sellerOrgId,
            );
            this.drivers.assertAssignable(driver);

            const driverVehicleIds = (
              await tx.vehicle.findMany({
                where: {
                  driverId: driver.id,
                  ...(actor?.sellerOrgId
                    ? { organizationId: actor.sellerOrgId }
                    : {}),
                },
                select: { id: true },
              })
            ).map((v) => v.id);

            if (driverVehicleIds.length > 0) {
              const driverConflict = await tx.vehicleSlot.findFirst({
                where: {
                  vehicleId: { in: driverVehicleIds },
                  slotDate,
                  timeSlot: window.timeSlot,
                  status: { in: [...ACTIVE_SLOT_STATUSES] },
                },
              });
              if (driverConflict) {
                throw new LogisticsException(
                  'VEHICLE_SLOT_UNAVAILABLE',
                  'Driver is unavailable for the selected time slot.',
                );
              }
            }
          }

          const bayConflict = await tx.vehicleSlot.findFirst({
            where: {
              warehouseId: input.warehouseId,
              slotDate,
              loadingBay,
              timeSlot: window.timeSlot,
              status: { in: [...ACTIVE_SLOT_STATUSES] },
            },
          });
          if (bayConflict) {
            throw new LogisticsException(
              'VEHICLE_SLOT_UNAVAILABLE',
              'This slot is no longer available. Please select another slot.',
            );
          }

          const created = await tx.vehicleSlot.create({
            data: {
              slotNumber: this.nextSlotNumber(),
              warehouseId: input.warehouseId,
              dispatchId: input.dispatchId,
              vehicleId: input.vehicleId,
              slotDate,
              startTime: window.startTime,
              endTime: window.endTime,
              timeSlot: window.timeSlot,
              loadingBay,
              quantityMt:
                input.quantityMt != null
                  ? toQty(input.quantityMt)
                  : dispatch
                    ? dispatch.quantity
                    : undefined,
              status: VehicleSlotStatus.REQUESTED,
              metadata: resolvedDriverId
                ? { driverId: resolvedDriverId }
                : undefined,
            },
            include: SLOT_INCLUDE,
          });

          if (dispatch && (input.vehicleId || resolvedDriverId)) {
            await tx.dispatch.update({
              where: { id: dispatch.id },
              data: {
                ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
                ...(resolvedDriverId ? { driverId: resolvedDriverId } : {}),
                ...(dispatch.status === DispatchStatus.AWAITING_VEHICLE ||
                dispatch.status === DispatchStatus.PLANNED ||
                dispatch.status === DispatchStatus.DRAFT
                  ? { status: DispatchStatus.VEHICLE_ASSIGNED }
                  : {}),
              },
            });
          }

          await this.events.record(tx, {
            dispatchId: input.dispatchId,
            eventType: 'VEHICLE_SLOT_REQUESTED',
            actorRole: actor?.role,
            actorUserId: actor?.userId,
            metadata: {
              slotId: created.id,
              slotNumber: created.slotNumber,
              loadingBay,
              timeSlot: window.timeSlot,
            },
          });

          return created;
        });

        return slot;
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
    throw new LogisticsException(
      'VEHICLE_SLOT_UNAVAILABLE',
      'This slot is no longer available. Please select another slot.',
    );
  }

  async list(params: VehicleSlotListParams) {
    const where = this.buildWhere(params);
    const orderBy = this.buildOrderBy(params.sortBy, params.sortOrder);

    const [items, total] = await Promise.all([
      this.prisma.vehicleSlot.findMany({
        where,
        orderBy,
        skip: params.skip,
        take: params.take,
        include: SLOT_INCLUDE,
      }),
      this.prisma.vehicleSlot.count({ where }),
    ]);
    return { items, total };
  }

  async summary(sellerOrgId: string, dateIso?: string) {
    const dateKey = dateIso ?? toDateKey(new Date());
    const slotDate = dateOnlyUtc(dateKey);

    const sellerWarehouses = await this.prisma.warehouse.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [
          { organizationId: sellerOrgId },
          {
            inventory: {
              some: { organizationId: sellerOrgId, deletedAt: null },
            },
          },
        ],
      },
      select: { id: true, metadata: true },
    });

    const warehouseIds = sellerWarehouses.map((w) => w.id);

    const daySlots = await this.prisma.vehicleSlot.findMany({
      where: {
        slotDate,
        dispatch: { sellerOrgId, deletedAt: null },
      },
      select: {
        status: true,
        warehouseId: true,
        loadingBay: true,
        timeSlot: true,
      },
    });

    const booked = daySlots.filter((s) =>
      (ACTIVE_SLOT_STATUSES as readonly string[]).includes(s.status),
    ).length;
    const completed = daySlots.filter(
      (s) => s.status === VehicleSlotStatus.COMPLETED,
    ).length;
    const cancelled = daySlots.filter(
      (s) =>
        s.status === VehicleSlotStatus.CANCELLED ||
        s.status === VehicleSlotStatus.MISSED ||
        s.status === VehicleSlotStatus.NO_SHOW,
    ).length;
    const total = daySlots.length;

    // Genuinely bookable capacity: free (warehouse, bay, window) combinations.
    const occupied = new Set(
      daySlots
        .filter((s) =>
          (ACTIVE_SLOT_STATUSES as readonly string[]).includes(s.status),
        )
        .map(
          (s) =>
            `${s.warehouseId}|${s.loadingBay ?? ''}|${s.timeSlot ?? ''}`,
        ),
    );

    let capacity = 0;
    for (const warehouse of sellerWarehouses) {
      const bays = loadingBaysForWarehouse(warehouse.metadata);
      capacity += bays.length * DEFAULT_TIME_WINDOWS.length;
    }
    // If seller has no warehouses yet, available is 0 (not fake capacity).
    const available =
      warehouseIds.length === 0
        ? 0
        : Math.max(0, capacity - occupied.size);

    return {
      date: dateKey,
      today: {
        total,
        booked,
        available,
        completed,
        cancelled,
      },
    };
  }

  async availability(params: {
    sellerOrgId: string;
    warehouseId: string;
    date: string;
    loadingBayId?: string;
    vehicleId?: string;
    vehicleType?: VehicleType;
  }) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: params.warehouseId, deletedAt: null },
    });
    if (!warehouse) {
      throw new LogisticsException(
        'VEHICLE_SLOT_NOT_FOUND',
        'Warehouse not found',
      );
    }

    const slotDate = dateOnlyUtc(params.date);
    const bays = params.loadingBayId
      ? [params.loadingBayId]
      : loadingBaysForWarehouse(warehouse.metadata);

    const existing = await this.prisma.vehicleSlot.findMany({
      where: {
        warehouseId: params.warehouseId,
        slotDate,
        status: { in: [...ACTIVE_SLOT_STATUSES] },
      },
      select: {
        id: true,
        loadingBay: true,
        timeSlot: true,
        vehicleId: true,
        status: true,
      },
    });

    const vehicleConflicts = params.vehicleId
      ? await this.prisma.vehicleSlot.findMany({
          where: {
            vehicleId: params.vehicleId,
            slotDate,
            status: { in: [...ACTIVE_SLOT_STATUSES] },
          },
          select: { timeSlot: true },
        })
      : [];
    const vehicleBlocked = new Set(
      vehicleConflicts.map((s) => s.timeSlot ?? ''),
    );

    const windows = DEFAULT_TIME_WINDOWS.map((window) => {
      const bayStates = bays.map((bay) => {
        const hit = existing.find(
          (s) => s.loadingBay === bay && s.timeSlot === window.timeSlot,
        );
        let availability: 'AVAILABLE' | 'BOOKED' | 'BLOCKED' = 'AVAILABLE';
        if (hit) availability = 'BOOKED';
        else if (vehicleBlocked.has(window.timeSlot)) availability = 'BLOCKED';
        return {
          loadingBay: bay,
          availability,
          slotId: hit?.id ?? null,
        };
      });

      const anyAvailable = bayStates.some((b) => b.availability === 'AVAILABLE');
      const allBooked = bayStates.every((b) => b.availability === 'BOOKED');
      let windowAvailability: 'AVAILABLE' | 'BOOKED' | 'FULL' | 'BLOCKED' =
        'AVAILABLE';
      if (vehicleBlocked.has(window.timeSlot)) windowAvailability = 'BLOCKED';
      else if (allBooked) windowAvailability = 'FULL';
      else if (!anyAvailable) windowAvailability = 'BOOKED';

      return {
        timeSlot: window.timeSlot,
        startTime: window.startTime,
        endTime: window.endTime,
        availability: windowAvailability,
        bays: bayStates,
      };
    });

    return {
      warehouseId: params.warehouseId,
      date: params.date,
      loadingBays: bays,
      windows,
    };
  }

  async listLoadingBays(warehouseId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, deletedAt: null },
    });
    if (!warehouse) {
      throw new LogisticsException(
        'VEHICLE_SLOT_NOT_FOUND',
        'Warehouse not found',
      );
    }
    return loadingBaysForWarehouse(warehouse.metadata).map((bay) => ({
      id: bay,
      name: bay,
    }));
  }

  async listWarehouses(sellerOrgId: string) {
    return this.prisma.warehouse.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [
          { organizationId: sellerOrgId },
          {
            inventory: {
              some: { organizationId: sellerOrgId, deletedAt: null },
            },
          },
          { isPlatformHub: true },
        ],
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        city: true,
        state: true,
        isPlatformHub: true,
      },
    });
  }

  async listEligibleDispatches(sellerOrgId: string, search?: string) {
    const items = await this.prisma.dispatch.findMany({
      where: {
        sellerOrgId,
        deletedAt: null,
        status: {
          in: [
            DispatchStatus.PLANNED,
            DispatchStatus.AWAITING_VEHICLE,
            DispatchStatus.VEHICLE_ASSIGNED,
            DispatchStatus.AWAITING_EWAY_BILL,
            DispatchStatus.READY_FOR_DISPATCH,
          ],
        },
        slots: {
          none: {
            status: { in: [...ACTIVE_SLOT_STATUSES] },
          },
        },
        ...(search
          ? {
              OR: [
                {
                  dispatchNumber: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  purchaseOrder: {
                    referenceNumber: {
                      contains: search,
                      mode: 'insensitive' as const,
                    },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        purchaseOrder: {
          select: { referenceNumber: true, status: true },
        },
      },
    });

    const enriched = [];
    for (const d of items) {
      const clearance = await this.gate.checkForPurchaseOrder(d.purchaseOrderId, {
        sellerOrgId,
      });
      if (!clearance.cleared) continue;
      enriched.push({
        id: d.id,
        dispatchNumber: d.dispatchNumber,
        purchaseOrderId: d.purchaseOrderId,
        purchaseOrderReference: d.purchaseOrder?.referenceNumber ?? null,
        status: d.status,
        quantity: toQty(d.quantity).toFixed(3),
        unit: d.unit,
        originWarehouseId: d.originWarehouseId,
        destinationRegion: d.destinationRegion,
        plannedDispatchDate: d.plannedDispatchDate,
        buyer: { displayName: 'Anonymous Buyer' },
        paymentCleared: true,
      });
    }
    return enriched;
  }

  async get(id: string, sellerOrgId?: string): Promise<SlotRow> {
    const slot = await this.prisma.vehicleSlot.findFirst({
      where: {
        id,
        ...(sellerOrgId
          ? { dispatch: { sellerOrgId, deletedAt: null } }
          : {}),
      },
      include: SLOT_INCLUDE,
    });
    if (!slot) {
      throw new LogisticsException('VEHICLE_SLOT_NOT_FOUND');
    }
    return slot;
  }

  async confirm(
    id: string,
    actor?: { userId?: string; role?: string },
  ): Promise<SlotRow> {
    const slot = await this.get(id);
    if (
      slot.status === VehicleSlotStatus.CANCELLED ||
      slot.status === VehicleSlotStatus.COMPLETED
    ) {
      throw new LogisticsException('VEHICLE_SLOT_UNAVAILABLE');
    }
    const updated = await this.prisma.vehicleSlot.update({
      where: { id },
      data: { status: VehicleSlotStatus.CONFIRMED },
      include: SLOT_INCLUDE,
    });
    await this.events.record(this.prisma, {
      dispatchId: slot.dispatchId,
      eventType: 'VEHICLE_SLOT_CONFIRMED',
      actorRole: actor?.role,
      actorUserId: actor?.userId,
      metadata: { slotId: id },
    });
    return updated;
  }

  async cancel(
    id: string,
    opts?: { sellerOrgId?: string; userId?: string; role?: string },
  ): Promise<SlotRow> {
    const slot = await this.get(id, opts?.sellerOrgId);
    if (
      slot.status === VehicleSlotStatus.CANCELLED ||
      slot.status === VehicleSlotStatus.COMPLETED
    ) {
      throw new LogisticsException('VEHICLE_SLOT_UNAVAILABLE');
    }
    if (
      slot.status === VehicleSlotStatus.LOADING ||
      slot.status === VehicleSlotStatus.CHECKED_IN
    ) {
      throw new LogisticsException(
        'VEHICLE_SLOT_UNAVAILABLE',
        'Slot cannot be cancelled after loading has started',
      );
    }
    const updated = await this.prisma.vehicleSlot.update({
      where: { id },
      data: { status: VehicleSlotStatus.CANCELLED },
      include: SLOT_INCLUDE,
    });
    await this.events.record(this.prisma, {
      dispatchId: slot.dispatchId,
      eventType: 'VEHICLE_SLOT_CANCELLED',
      actorRole: opts?.role,
      actorUserId: opts?.userId,
      metadata: { slotId: id },
    });
    return updated;
  }

  toView(s: VehicleSlot | SlotRow) {
    return toSellerVehicleSlot(s as SlotRow);
  }

  private buildWhere(params: VehicleSlotListParams): Prisma.VehicleSlotWhereInput {
    const and: Prisma.VehicleSlotWhereInput[] = [];

    if (params.sellerOrgId) {
      and.push({
        dispatch: { sellerOrgId: params.sellerOrgId, deletedAt: null },
      });
    }
    if (params.status) and.push({ status: params.status });
    if (params.warehouseId) and.push({ warehouseId: params.warehouseId });
    if (params.dispatchId) and.push({ dispatchId: params.dispatchId });
    if (params.date) {
      and.push({ slotDate: dateOnlyUtc(params.date) });
    } else if (params.dateFrom || params.dateTo) {
      and.push({
        slotDate: {
          ...(params.dateFrom ? { gte: dateOnlyUtc(params.dateFrom) } : {}),
          ...(params.dateTo ? { lte: dateOnlyUtc(params.dateTo) } : {}),
        },
      });
    }
    if (params.vehicleType) {
      and.push({ vehicle: { type: params.vehicleType } });
    }
    if (params.carrier) {
      and.push({
        vehicle: {
          transporterName: {
            contains: params.carrier,
            mode: 'insensitive',
          },
        },
      });
    }
    if (params.orderId) {
      and.push({
        OR: [
          {
            dispatch: {
              purchaseOrder: {
                referenceNumber: {
                  contains: params.orderId,
                  mode: 'insensitive',
                },
              },
            },
          },
          {
            dispatch: {
              purchaseOrderId: params.orderId,
            },
          },
          {
            dispatch: {
              dispatchNumber: {
                contains: params.orderId,
                mode: 'insensitive',
              },
            },
          },
        ],
      });
    }
    if (params.search) {
      const q = params.search.trim();
      and.push({
        OR: [
          { slotNumber: { contains: q, mode: 'insensitive' } },
          { loadingBay: { contains: q, mode: 'insensitive' } },
          { timeSlot: { contains: q, mode: 'insensitive' } },
          {
            vehicle: {
              numberPlate: { contains: q, mode: 'insensitive' },
            },
          },
          {
            dispatch: {
              dispatchNumber: { contains: q, mode: 'insensitive' },
            },
          },
          {
            dispatch: {
              purchaseOrder: {
                referenceNumber: { contains: q, mode: 'insensitive' },
              },
            },
          },
        ],
      });
    }

    return and.length ? { AND: and } : {};
  }

  private buildOrderBy(
    sortBy?: string,
    sortOrder: 'asc' | 'desc' = 'desc',
  ): Prisma.VehicleSlotOrderByWithRelationInput {
    switch (sortBy) {
      case 'status':
        return { status: sortOrder };
      case 'createdAt':
        return { createdAt: sortOrder };
      case 'slotNumber':
        return { slotNumber: sortOrder };
      case 'slotDate':
      default:
        return { slotDate: sortOrder };
    }
  }
}
