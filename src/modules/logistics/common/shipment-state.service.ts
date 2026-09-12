import { Injectable } from '@nestjs/common';
import { ShipmentStatus } from '../../../generated/prisma/client.js';
import { LogisticsException } from './logistics.errors.js';

/** Tracking / lifecycle transitions used by Phase 9 APIs. */
const ALLOWED: Record<ShipmentStatus, ShipmentStatus[]> = {
  [ShipmentStatus.PLANNED]: [
    ShipmentStatus.READY_TO_DISPATCH,
    ShipmentStatus.DISPATCHED,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.SLOT_BOOKED]: [
    ShipmentStatus.READY_TO_DISPATCH,
    ShipmentStatus.LOADING,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.READY_TO_DISPATCH]: [
    ShipmentStatus.LOADING,
    ShipmentStatus.DISPATCHED,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.LOADING]: [
    ShipmentStatus.DISPATCHED,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.DISPATCHED]: [
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.DELAYED,
    ShipmentStatus.EXCEPTION,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.IN_TRANSIT]: [
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.DELAYED,
    ShipmentStatus.EXCEPTION,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.OUT_FOR_DELIVERY]: [
    ShipmentStatus.DELIVERED,
    ShipmentStatus.DELAYED,
    ShipmentStatus.EXCEPTION,
    ShipmentStatus.FAILED,
  ],
  [ShipmentStatus.DELIVERED]: [
    ShipmentStatus.DELIVERY_CONFIRMED,
    ShipmentStatus.EXCEPTION,
  ],
  [ShipmentStatus.DELIVERY_CONFIRMED]: [],
  [ShipmentStatus.DELAYED]: [
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.EXCEPTION,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.CANCELLED]: [],
  [ShipmentStatus.FAILED]: [ShipmentStatus.EXCEPTION],
  [ShipmentStatus.EXCEPTION]: [
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.CANCELLED,
  ],
};

/** Seller/admin tracking event chain for in-flight shipments. */
export const TRACKING_CHAIN: ShipmentStatus[] = [
  ShipmentStatus.DISPATCHED,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.OUT_FOR_DELIVERY,
  ShipmentStatus.DELIVERED,
];

@Injectable()
export class ShipmentStateService {
  assertTransition(from: ShipmentStatus, to: ShipmentStatus): void {
    if (from === to) return;
    const allowed = ALLOWED[from] ?? [];
    if (!allowed.includes(to)) {
      throw new LogisticsException(
        'INVALID_SHIPMENT_TRANSITION',
        `Cannot transition shipment from ${from} to ${to}`,
      );
    }
  }

  assertTrackingTransition(from: ShipmentStatus, to: ShipmentStatus): void {
    if (from === to) return;
    const fromIdx = TRACKING_CHAIN.indexOf(from);
    const toIdx = TRACKING_CHAIN.indexOf(to);
    if (fromIdx < 0 || toIdx < 0 || toIdx !== fromIdx + 1) {
      throw new LogisticsException(
        'INVALID_SHIPMENT_TRANSITION',
        `Invalid tracking transition from ${from} to ${to}`,
      );
    }
  }
}
