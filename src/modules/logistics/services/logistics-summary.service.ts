import { Injectable } from '@nestjs/common';
import {
  DeliveryStatus,
  DispatchStatus,
  ShipmentStatus,
  VehicleSlotStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  SELLER_DISPATCH_TAB_STATUSES,
  type SellerDispatchTab,
} from '../common/dispatch-tab.util.js';

@Injectable()
export class LogisticsSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async forSellerDispatches(sellerOrgId: string) {
    const base = { sellerOrgId, deletedAt: null as null };
    const count = (statuses: DispatchStatus[]) =>
      this.prisma.dispatch.count({
        where: { ...base, status: { in: statuses } },
      });

    const [all, readyForDispatch, scheduled, loading, dispatched] =
      await Promise.all([
        this.prisma.dispatch.count({
          where: {
            ...base,
            status: { not: DispatchStatus.CANCELLED },
          },
        }),
        count(SELLER_DISPATCH_TAB_STATUSES.ready),
        count(SELLER_DISPATCH_TAB_STATUSES.scheduled),
        count(SELLER_DISPATCH_TAB_STATUSES.loading),
        count(SELLER_DISPATCH_TAB_STATUSES.dispatched),
      ]);

    return {
      all,
      readyForDispatch,
      scheduled,
      loading,
      dispatched,
      byTab: {
        all,
        ready: readyForDispatch,
        scheduled,
        loading,
        dispatched,
      } satisfies Record<'all' | SellerDispatchTab, number>,
    };
  }

  async forSeller(sellerOrgId: string) {
    const [
      pendingDispatches,
      awaitingVehicle,
      vehicleAssigned,
      readyToDispatch,
      inTransit,
      outForDelivery,
      delivered,
      exceptions,
    ] = await Promise.all([
      this.prisma.dispatch.count({
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
              DispatchStatus.LOADING,
              DispatchStatus.LOADED,
            ],
          },
        },
      }),
      this.prisma.dispatch.count({
        where: {
          sellerOrgId,
          deletedAt: null,
          status: DispatchStatus.AWAITING_VEHICLE,
        },
      }),
      this.prisma.dispatch.count({
        where: {
          sellerOrgId,
          deletedAt: null,
          status: {
            in: [
              DispatchStatus.VEHICLE_ASSIGNED,
              DispatchStatus.AWAITING_EWAY_BILL,
            ],
          },
        },
      }),
      this.prisma.dispatch.count({
        where: {
          sellerOrgId,
          deletedAt: null,
          status: {
            in: [
              DispatchStatus.READY_FOR_DISPATCH,
              DispatchStatus.LOADING,
              DispatchStatus.LOADED,
            ],
          },
        },
      }),
      this.prisma.shipment.count({
        where: {
          sellerOrgId,
          deletedAt: null,
          status: ShipmentStatus.IN_TRANSIT,
        },
      }),
      this.prisma.shipment.count({
        where: {
          sellerOrgId,
          deletedAt: null,
          status: ShipmentStatus.OUT_FOR_DELIVERY,
        },
      }),
      this.prisma.shipment.count({
        where: {
          sellerOrgId,
          deletedAt: null,
          status: {
            in: [ShipmentStatus.DELIVERED, ShipmentStatus.DELIVERY_CONFIRMED],
          },
        },
      }),
      this.prisma.delivery.count({
        where: {
          sellerOrgId,
          status: DeliveryStatus.EXCEPTION,
        },
      }),
    ]);

    return {
      pendingDispatches,
      awaitingVehicle,
      vehicleAssigned,
      readyToDispatch,
      inTransit,
      outForDelivery,
      delivered,
      exceptions,
    };
  }

  async forCustomer(customerOrgId: string) {
    const [
      activeShipments,
      inTransit,
      outForDelivery,
      delivered,
      pendingDeliveries,
    ] = await Promise.all([
      this.prisma.shipment.count({
        where: {
          customerOrgId,
          deletedAt: null,
          status: {
            in: [
              ShipmentStatus.DISPATCHED,
              ShipmentStatus.IN_TRANSIT,
              ShipmentStatus.OUT_FOR_DELIVERY,
              ShipmentStatus.DELAYED,
            ],
          },
        },
      }),
      this.prisma.shipment.count({
        where: {
          customerOrgId,
          deletedAt: null,
          status: ShipmentStatus.IN_TRANSIT,
        },
      }),
      this.prisma.shipment.count({
        where: {
          customerOrgId,
          deletedAt: null,
          status: ShipmentStatus.OUT_FOR_DELIVERY,
        },
      }),
      this.prisma.shipment.count({
        where: {
          customerOrgId,
          deletedAt: null,
          status: {
            in: [ShipmentStatus.DELIVERED, ShipmentStatus.DELIVERY_CONFIRMED],
          },
        },
      }),
      this.prisma.delivery.count({
        where: {
          customerOrgId,
          status: {
            in: [
              DeliveryStatus.SCHEDULED,
              DeliveryStatus.OUT_FOR_DELIVERY,
              DeliveryStatus.DELIVERED,
              DeliveryStatus.PARTIAL,
            ],
          },
        },
      }),
    ]);

    return {
      activeShipments,
      inTransit,
      outForDelivery,
      delivered,
      pendingDeliveries,
    };
  }

  async forAdmin() {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const [
      pendingDispatches,
      vehicleSlotsToday,
      awaitingVehicle,
      awaitingEwayBill,
      readyToDispatch,
      inTransit,
      outForDelivery,
      delivered,
      exceptions,
    ] = await Promise.all([
      this.prisma.dispatch.count({
        where: {
          deletedAt: null,
          status: {
            notIn: [DispatchStatus.DISPATCHED, DispatchStatus.CANCELLED],
          },
        },
      }),
      this.prisma.vehicleSlot.count({
        where: {
          slotDate: { gte: start, lt: end },
          status: {
            notIn: [VehicleSlotStatus.CANCELLED, VehicleSlotStatus.MISSED],
          },
        },
      }),
      this.prisma.dispatch.count({
        where: {
          deletedAt: null,
          status: DispatchStatus.AWAITING_VEHICLE,
        },
      }),
      this.prisma.dispatch.count({
        where: {
          deletedAt: null,
          status: DispatchStatus.AWAITING_EWAY_BILL,
        },
      }),
      this.prisma.dispatch.count({
        where: {
          deletedAt: null,
          status: DispatchStatus.READY_FOR_DISPATCH,
        },
      }),
      this.prisma.shipment.count({
        where: { deletedAt: null, status: ShipmentStatus.IN_TRANSIT },
      }),
      this.prisma.shipment.count({
        where: {
          deletedAt: null,
          status: ShipmentStatus.OUT_FOR_DELIVERY,
        },
      }),
      this.prisma.shipment.count({
        where: {
          deletedAt: null,
          status: {
            in: [ShipmentStatus.DELIVERED, ShipmentStatus.DELIVERY_CONFIRMED],
          },
        },
      }),
      this.prisma.delivery.count({
        where: { status: DeliveryStatus.EXCEPTION },
      }),
    ]);

    return {
      pendingDispatches,
      vehicleSlotsToday,
      awaitingVehicle,
      awaitingEwayBill,
      readyToDispatch,
      inTransit,
      outForDelivery,
      delivered,
      exceptions,
    };
  }
}
