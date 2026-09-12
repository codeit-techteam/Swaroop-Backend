import { Injectable } from '@nestjs/common';
import { DispatchStatus } from '../../../generated/prisma/client.js';
import { LogisticsException } from './logistics.errors.js';

const ALLOWED: Record<DispatchStatus, DispatchStatus[]> = {
  [DispatchStatus.DRAFT]: [
    DispatchStatus.PLANNED,
    DispatchStatus.AWAITING_VEHICLE,
    DispatchStatus.CANCELLED,
  ],
  [DispatchStatus.PLANNED]: [
    DispatchStatus.AWAITING_VEHICLE,
    DispatchStatus.CANCELLED,
  ],
  [DispatchStatus.AWAITING_VEHICLE]: [
    DispatchStatus.VEHICLE_ASSIGNED,
    DispatchStatus.AWAITING_EWAY_BILL,
    DispatchStatus.CANCELLED,
  ],
  [DispatchStatus.VEHICLE_ASSIGNED]: [
    DispatchStatus.AWAITING_EWAY_BILL,
    DispatchStatus.READY_FOR_DISPATCH,
    DispatchStatus.CANCELLED,
  ],
  [DispatchStatus.AWAITING_EWAY_BILL]: [
    DispatchStatus.READY_FOR_DISPATCH,
    DispatchStatus.VEHICLE_ASSIGNED,
    DispatchStatus.CANCELLED,
  ],
  [DispatchStatus.READY_FOR_DISPATCH]: [
    DispatchStatus.LOADING,
    DispatchStatus.LOADED,
    DispatchStatus.DISPATCHED,
    DispatchStatus.CANCELLED,
  ],
  [DispatchStatus.LOADING]: [DispatchStatus.LOADED, DispatchStatus.CANCELLED],
  [DispatchStatus.LOADED]: [
    DispatchStatus.DISPATCHED,
    DispatchStatus.CANCELLED,
  ],
  [DispatchStatus.DISPATCHED]: [],
  [DispatchStatus.CANCELLED]: [],
};

@Injectable()
export class DispatchStateService {
  assertTransition(from: DispatchStatus, to: DispatchStatus): void {
    if (from === to) return;
    const allowed = ALLOWED[from] ?? [];
    if (!allowed.includes(to)) {
      throw new LogisticsException(
        'INVALID_DISPATCH_TRANSITION',
        `Cannot transition dispatch from ${from} to ${to}`,
      );
    }
  }

  isTerminal(status: DispatchStatus): boolean {
    return (
      status === DispatchStatus.DISPATCHED ||
      status === DispatchStatus.CANCELLED
    );
  }

  isActive(status: DispatchStatus): boolean {
    return !this.isTerminal(status);
  }
}
