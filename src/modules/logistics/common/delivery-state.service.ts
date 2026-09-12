import { Injectable } from '@nestjs/common';
import { DeliveryStatus } from '../../../generated/prisma/client.js';
import { LogisticsException } from './logistics.errors.js';

const ALLOWED: Record<DeliveryStatus, DeliveryStatus[]> = {
  [DeliveryStatus.SCHEDULED]: [
    DeliveryStatus.OUT_FOR_DELIVERY,
    DeliveryStatus.DELIVERED,
    DeliveryStatus.PARTIAL,
    DeliveryStatus.CANCELLED,
    DeliveryStatus.EXCEPTION,
    DeliveryStatus.FAILED,
  ],
  [DeliveryStatus.OUT_FOR_DELIVERY]: [
    DeliveryStatus.DELIVERED,
    DeliveryStatus.PARTIAL,
    DeliveryStatus.FAILED,
    DeliveryStatus.EXCEPTION,
    DeliveryStatus.CANCELLED,
  ],
  [DeliveryStatus.DELIVERED]: [
    DeliveryStatus.CONFIRMED,
    DeliveryStatus.EXCEPTION,
  ],
  [DeliveryStatus.PARTIAL]: [
    DeliveryStatus.DELIVERED,
    DeliveryStatus.CONFIRMED,
    DeliveryStatus.EXCEPTION,
  ],
  [DeliveryStatus.CONFIRMED]: [],
  [DeliveryStatus.FAILED]: [DeliveryStatus.EXCEPTION, DeliveryStatus.SCHEDULED],
  [DeliveryStatus.CANCELLED]: [],
  [DeliveryStatus.EXCEPTION]: [
    DeliveryStatus.SCHEDULED,
    DeliveryStatus.OUT_FOR_DELIVERY,
    DeliveryStatus.DELIVERED,
    DeliveryStatus.CANCELLED,
  ],
};

@Injectable()
export class DeliveryStateService {
  assertTransition(from: DeliveryStatus, to: DeliveryStatus): void {
    if (from === to) return;
    const allowed = ALLOWED[from] ?? [];
    if (!allowed.includes(to)) {
      throw new LogisticsException(
        'INVALID_DELIVERY_TRANSITION',
        `Cannot transition delivery from ${from} to ${to}`,
      );
    }
  }
}
