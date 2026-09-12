import { Injectable } from '@nestjs/common';
import {
  Prisma,
  VehicleSlotStatus,
  type VehicleSlot,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { LogisticsException } from '../common/logistics.errors.js';
import { LogisticsEventsService } from '../common/logistics-events.service.js';
import { toSellerVehicleSlot } from '../common/blind-logistics.mapper.js';
import { toQty } from '../common/quantity.util.js';

export type CreateSlotInput = {
  warehouseId: string;
  dispatchId?: string;
  vehicleId?: string;
  slotDate: string;
  startTime?: string;
  endTime?: string;
  timeSlot?: string;
  loadingBay?: string;
  quantityMt?: number;
};

@Injectable()
export class VehicleSlotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: LogisticsEventsService,
  ) {}

  nextSlotNumber(now = new Date()): string {
    const year = now.getFullYear();
    const seq = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0');
    return `SLT-${year}-${seq}`;
  }

  async create(
    input: CreateSlotInput,
    actor?: { userId?: string; role?: string },
  ): Promise<VehicleSlot> {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: input.warehouseId, deletedAt: null },
    });
    if (!warehouse) {
      throw new LogisticsException(
        'VEHICLE_SLOT_NOT_FOUND',
        'Warehouse not found',
      );
    }

    if (input.dispatchId) {
      const dispatch = await this.prisma.dispatch.findFirst({
        where: { id: input.dispatchId, deletedAt: null },
      });
      if (!dispatch) {
        throw new LogisticsException('DISPATCH_NOT_FOUND');
      }
    }

    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const slot = await this.prisma.vehicleSlot.create({
          data: {
            slotNumber: this.nextSlotNumber(),
            warehouseId: input.warehouseId,
            dispatchId: input.dispatchId,
            vehicleId: input.vehicleId,
            slotDate: new Date(input.slotDate),
            startTime: input.startTime,
            endTime: input.endTime,
            timeSlot: input.timeSlot,
            loadingBay: input.loadingBay,
            quantityMt:
              input.quantityMt != null ? toQty(input.quantityMt) : undefined,
            status: VehicleSlotStatus.REQUESTED,
          },
        });

        await this.events.record(this.prisma, {
          dispatchId: input.dispatchId,
          eventType: 'VEHICLE_SLOT_REQUESTED',
          actorRole: actor?.role,
          actorUserId: actor?.userId,
          metadata: { slotId: slot.id },
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
    throw new Error('Failed to create vehicle slot');
  }

  async list(params: {
    sellerOrgId?: string;
    skip: number;
    take: number;
    status?: VehicleSlotStatus;
  }) {
    const where: Prisma.VehicleSlotWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.sellerOrgId
        ? { dispatch: { sellerOrgId: params.sellerOrgId, deletedAt: null } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.vehicleSlot.findMany({
        where,
        orderBy: { slotDate: 'desc' },
        skip: params.skip,
        take: params.take,
        include: { dispatch: true },
      }),
      this.prisma.vehicleSlot.count({ where }),
    ]);
    return { items, total };
  }

  async get(id: string, sellerOrgId?: string) {
    const slot = await this.prisma.vehicleSlot.findFirst({
      where: {
        id,
        ...(sellerOrgId ? { dispatch: { sellerOrgId, deletedAt: null } } : {}),
      },
      include: { dispatch: true },
    });
    if (!slot) {
      throw new LogisticsException('VEHICLE_SLOT_NOT_FOUND');
    }
    return slot;
  }

  async confirm(
    id: string,
    actor?: { userId?: string; role?: string },
  ): Promise<VehicleSlot> {
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
  ): Promise<VehicleSlot> {
    const slot = await this.get(id, opts?.sellerOrgId);
    if (
      slot.status === VehicleSlotStatus.CANCELLED ||
      slot.status === VehicleSlotStatus.COMPLETED
    ) {
      throw new LogisticsException('VEHICLE_SLOT_UNAVAILABLE');
    }
    const updated = await this.prisma.vehicleSlot.update({
      where: { id },
      data: { status: VehicleSlotStatus.CANCELLED },
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

  toView(s: VehicleSlot) {
    return toSellerVehicleSlot(s);
  }
}
