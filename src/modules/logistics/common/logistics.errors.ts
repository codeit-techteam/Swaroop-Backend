import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';

export const LOGISTICS_ERROR_CODES = [
  'PO_NOT_FOUND',
  'PO_NOT_ELIGIBLE_FOR_DISPATCH',
  'PAYMENT_NOT_CLEARED',
  'DISPATCH_NOT_FOUND',
  'DISPATCH_ALREADY_CREATED',
  'DISPATCH_QUANTITY_EXCEEDED',
  'INVALID_DISPATCH_TRANSITION',
  'INSUFFICIENT_INVENTORY',
  'VEHICLE_NOT_FOUND',
  'VEHICLE_ALREADY_ASSIGNED',
  'VEHICLE_CAPACITY_INSUFFICIENT',
  'VEHICLE_DOCUMENT_EXPIRED',
  'VEHICLE_NOT_COMPLIANT',
  'DRIVER_NOT_FOUND',
  'DRIVER_LICENSE_EXPIRED',
  'VEHICLE_SLOT_NOT_FOUND',
  'VEHICLE_SLOT_UNAVAILABLE',
  'EWAY_BILL_REQUIRED',
  'EWAY_BILL_EXPIRED',
  'EWAY_BILL_INVALID',
  'SHIPMENT_NOT_FOUND',
  'SHIPMENT_ALREADY_CREATED',
  'INVALID_SHIPMENT_TRANSITION',
  'DELIVERY_NOT_FOUND',
  'INVALID_DELIVERY_TRANSITION',
  'DELIVERY_QUANTITY_EXCEEDED',
  'DELIVERY_ALREADY_CONFIRMED',
  'DELIVERY_EXCEPTION',
  'UNAUTHORIZED_LOGISTICS_ACCESS',
  'IDEMPOTENCY_CONFLICT',
] as const;

export type LogisticsErrorCode = (typeof LOGISTICS_ERROR_CODES)[number];

const CONFLICT_CODES = new Set<LogisticsErrorCode>([
  'DISPATCH_ALREADY_CREATED',
  'SHIPMENT_ALREADY_CREATED',
  'VEHICLE_ALREADY_ASSIGNED',
  'DELIVERY_ALREADY_CONFIRMED',
  'IDEMPOTENCY_CONFLICT',
  'PAYMENT_NOT_CLEARED',
  'VEHICLE_SLOT_UNAVAILABLE',
]);

const FORBIDDEN_CODES = new Set<LogisticsErrorCode>([
  'UNAUTHORIZED_LOGISTICS_ACCESS',
]);

const NOT_FOUND_CODES = new Set<LogisticsErrorCode>([
  'PO_NOT_FOUND',
  'DISPATCH_NOT_FOUND',
  'VEHICLE_NOT_FOUND',
  'DRIVER_NOT_FOUND',
  'VEHICLE_SLOT_NOT_FOUND',
  'SHIPMENT_NOT_FOUND',
  'DELIVERY_NOT_FOUND',
]);

/**
 * Domain exception for logistics workflow.
 * 409 for conflicts/gates; 403 ownership; 404 missing; 400 otherwise.
 */
export class LogisticsException extends HttpException {
  readonly code: LogisticsErrorCode;

  constructor(code: LogisticsErrorCode, message?: string) {
    const payload = { code, message: message ?? code };
    let status = 400;
    if (CONFLICT_CODES.has(code)) status = 409;
    else if (FORBIDDEN_CODES.has(code)) status = 403;
    else if (NOT_FOUND_CODES.has(code)) status = 404;
    super(payload, status);
    this.code = code;
  }

  static conflict(code: LogisticsErrorCode, message?: string): never {
    throw new ConflictException({ code, message: message ?? code });
  }

  static badRequest(code: LogisticsErrorCode, message?: string): never {
    throw new BadRequestException({ code, message: message ?? code });
  }

  static forbidden(code: LogisticsErrorCode, message?: string): never {
    throw new ForbiddenException({ code, message: message ?? code });
  }

  static notFound(code: LogisticsErrorCode, message?: string): never {
    throw new NotFoundException({ code, message: message ?? code });
  }
}
